import { useState } from 'preact/hooks';
import { C, phrase } from '../data';
import { PLACEMENT, randomPrice, shuffle, STEPS, todaysSession, type Ex } from '../lesson';
import { scheduleReminders } from '../reminders';
import { grade, isLearned, learnedCount, dueIds } from '../srs';
import { finishScene, scenes } from '../scenes';
import { currentStreak, dayLog, finishDay, logDay, noteMiss, today, trickyIds, update, useProgress, type SessionState } from '../store';
import type { Scene } from '../types';
import { Icon } from '../ui/icons';
import { HeartsBar, Lesson, type Answer } from '../ui/Lesson';
import { MissionCard, MissionsView } from '../ui/Missions';
import { RegularsRow, RegularView } from '../ui/Regulars';
import { ScenePlayer } from '../ui/Scene';

type Run =
  | { kind: 'session' }
  | { kind: 'placement' }
  | { kind: 'practice'; title: string; exs: string[] }
  | { kind: 'regular'; who: string }
  | { kind: 'scene'; scene: Scene; back: string }
  | { kind: 'missions' };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** The last quiz for a new phrase decides how well it went. */
const isFinalLearnQuiz = (ex: Ex) => {
  const p = phrase(ex.id);
  return !!p && ((p.kind === 'say' && ex.type === 'recall') || (p.kind !== 'say' && ex.type === 'meaning'));
};

export function Today() {
  const p = useProgress();
  const [run, setRun] = useState<Run | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const log = dayLog(p);
  const session = p.session?.date === today() ? p.session : null;
  const total = C().phrases.length;
  const learned = learnedCount();
  const streak = currentStreak(p);
  const due = dueIds(99).length;
  const tricky = trickyIds(p).filter(id => !!phrase(id));

  // Every answer feeds the Tricky ones list; only first attempts move the review schedule.
  const onSessionAnswer = (stepKey: string) => ({ ex, ok, first }: Answer) => {
    if (ex.type === 'price') return;
    noteMiss(ex.id, ok);
    if (!first) return;
    logDay(d => { d.tries = (d.tries ?? 0) + 1; d.right = (d.right ?? 0) + (ok ? 1 : 0); });
    if (stepKey === 'review') { grade(ex.id, ok ? 'good' : 'again'); logDay(d => { d.reviews++; }); }
    if (stepKey === 'learn' && isFinalLearnQuiz(ex)) { grade(ex.id, ok ? 'good' : 'again'); logDay(d => { d.learned++; }); }
    if (stepKey === 'listen' && isLearned(ex.id)) grade(ex.id, ok ? 'good' : 'again');
  };

  const onPracticeAnswer = ({ ex, ok, first }: Answer) => {
    if (ex.type === 'price') return;
    noteMiss(ex.id, ok);
    if (first && isLearned(ex.id)) grade(ex.id, ok ? 'good' : 'again');
  };

  const advanceSession = (s: SessionState) => {
    const last = s.step + 1 >= s.steps.length;
    update(p => { if (p.session) p.session = { ...p.session, step: s.step + 1, index: 0 }; });
    if (last) {
      finishDay();
      scheduleReminders();
      setRun(null);
      setCelebrate(true);
    }
  };

  if (run?.kind === 'session') {
    const s = todaysSession();
    const step = s.steps[s.step];
    if (!step) { setRun(null); return null; }
    if (step.key === 'scene') {
      const sc = scenes().find(x => `scene:${x.id}` === step.ids[0]);
      if (!sc) { advanceSession(s); return null; }
      return <ScenePlayer key={sc.id} scene={sc} onDone={() => { finishScene(sc.id); advanceSession(s); }} onExit={() => setRun(null)} />;
    }
    return (
      <Lesson
        key={`${s.date}-${s.step}`}
        title={STEPS[step.key].title}
        exs={step.ids}
        start={s.index}
        onAnswer={onSessionAnswer(step.key)}
        onQueue={queue => update(p => {
          if (!p.session) return;
          const steps = p.session.steps.map((st, k) => (k === p.session!.step ? { ...st, ids: queue } : st));
          p.session = { ...p.session, steps };
        })}
        onProgress={index => update(p => { if (p.session) p.session = { ...p.session, index }; })}
        onDone={() => advanceSession(s)}
        onExit={() => setRun(null)}
      />
    );
  }

  if (run?.kind === 'scene') {
    const back = run.back;
    return <ScenePlayer key={run.scene.id} scene={run.scene} onDone={() => { finishScene(run.scene.id); setRun({ kind: 'regular', who: back }); }} onExit={() => setRun({ kind: 'regular', who: back })} />;
  }
  if (run?.kind === 'regular') {
    return <RegularView who={run.who} onBack={() => setRun(null)} onPlay={sc => setRun({ kind: 'scene', scene: sc, back: run.who })} />;
  }
  if (run?.kind === 'missions') return <MissionsView onBack={() => setRun(null)} />;

  if (run?.kind === 'placement') {
    return (
      <Lesson
        title="Quick check"
        exs={PLACEMENT}
        useHearts={false}
        dontKnow
        requeue={false}
        onAnswer={({ ex, ok }) => { if (ok && ex.type !== 'price') grade(ex.id, 'easy'); }}
        onDone={() => { update(p => { p.placementDone = true; p.session = null; }); setRun(null); }}
        onExit={() => { update(p => { p.placementDone = true; p.session = null; }); setRun(null); }}
      />
    );
  }

  if (run?.kind === 'practice') {
    return (
      <Lesson
        title={run.title}
        exs={run.exs}
        onAnswer={onPracticeAnswer}
        onDone={() => setRun(null)}
        onExit={() => setRun(null)}
      />
    );
  }

  const steps = session?.steps ?? [];
  const started = !!session && (session.step > 0 || session.index > 0);
  const done = !!log.done;

  return (
    <div class="screen">
      <header class="today-head">
        <div>
          <div class="eyebrow">{greeting()}</div>
          <h1 lang="th" class="hello">สวัสดีครับ</h1>
        </div>
        <div class="chips-row">
          <span class={`chip-stat${streak ? ' warm' : ''}`}><Icon name="flame" size={16} />{streak} day{streak === 1 ? '' : 's'}</span>
          <HeartsBar />
        </div>
      </header>

      {celebrate && (
        <section class="card celebrate">
          <Icon name="sparkle" size={28} />
          <div><b>Session done.</b> {log.learned ? `${log.learned} new phrases, ` : ''}{log.reviews} reviews. See you tomorrow.</div>
          <button class="icon-btn" onClick={() => setCelebrate(false)} aria-label="Dismiss"><Icon name="close" size={18} /></button>
        </section>
      )}

      {!p.placementDone && (
        <section class="card placement">
          <h2>Where are you starting from?</h2>
          <p class="muted">New to Thai? Start from the very first phrase. Know a few bits already? A 3-minute check skips them. Tap "Don't know" rather than guessing.</p>
          <div class="row">
            <button class="btn primary" onClick={() => update(p => { p.placementDone = true; p.session = null; })}>I'm new to Thai</button>
            <button class="btn ghost" onClick={() => setRun({ kind: 'placement' })}>Take the check</button>
          </div>
        </section>
      )}

      <section class="card session">
        <div class="session-head">
          <div>
            <h2>{done ? 'Done for today' : "Today's session"}</h2>
            <p class="muted">{done ? 'Nice work. Extra practice is below if you want more.' : 'About 15–20 minutes. Pause any time; your place is saved.'}</p>
          </div>
          {done && <span class="done-badge"><Icon name="check" size={22} /></span>}
        </div>
        <ol class="steps">
          {(steps.length ? steps : (['review', 'learn', 'listen', 'prices'].map(key => ({ key, ids: [] as string[] })))).map((st, k) => {
            const info = STEPS[st.key];
            const state = done || (session && k < session.step) ? 'done' : session && k === session.step ? 'now' : 'later';
            const count = st.ids.length ? (st.key === 'learn' ? `${st.ids.filter(x => x.startsWith('intro:')).length} phrases` : `${st.ids.length} items`) : '';
            return (
              <li class={`step ${state}`} key={st.key}>
                <span class="step-dot">{state === 'done' ? <Icon name="check" size={14} /> : <Icon name={info.icon} size={14} />}</span>
                <span class="step-text"><b>{info.title}</b><span class="muted">{count || info.blurb}</span></span>
              </li>
            );
          })}
        </ol>
        {!done && (
          <button class="btn primary wide" onClick={() => { todaysSession(); setRun({ kind: 'session' }); }}>
            {started ? 'Continue' : 'Start'}
          </button>
        )}
      </section>

      <MissionCard onAll={() => setRun({ kind: 'missions' })} />

      <RegularsRow onOpen={who => setRun({ kind: 'regular', who })} />

      <section class="stats">
        <div class="stat"><b>{learned}</b><span>of {total} phrases learned</span></div>
        <div class="stat"><b>{due}</b><span>due for review</span></div>
      </section>

      <section class="block">
        <h3>Extra practice</h3>
        <div class="practice">
          {tricky.length > 0 && (
            <button class="tile-btn tricky" onClick={() => setRun({ kind: 'practice', title: 'Tricky ones', exs: shuffle(tricky).map(id => `${phrase(id)?.kind === 'say' ? 'recall' : 'meaning'}:${id}`) })}>
              <Icon name="flag" /><b>Tricky ones</b><span>{tricky.length} you've missed</span>
            </button>
          )}
          <button class="tile-btn" onClick={() => setRun({ kind: 'practice', title: 'Listening drill', exs: shuffle(C().phrases.filter(x => x.kind === 'hear')).slice(0, 8).map(x => `listen:${x.id}`) })}>
            <Icon name="ear" /><b>Listening drill</b><span>What staff say</span>
          </button>
          <button class="tile-btn" onClick={() => setRun({ kind: 'practice', title: 'Price drill', exs: Array.from({ length: 8 }, () => `price:${randomPrice()}`) })}>
            <Icon name="coins" /><b>Price drill</b><span>Catch the number</span>
          </button>
          {due > 0 && done && (
            <button class="tile-btn" onClick={() => setRun({ kind: 'practice', title: 'Extra review', exs: dueIds(15).map(id => `meaning:${id}`) })}>
              <Icon name="sparkle" /><b>Review more</b><span>{due} due</span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
