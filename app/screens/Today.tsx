import { useState } from 'preact/hooks';
import { C, phrase } from '../data';
import { PLACEMENT, randomPrice, shuffle, STEPS, todaysSession, type Ex } from '../lesson';
import { scheduleReminders } from '../reminders';
import { grade, isLearned, learnedCount, dueIds } from '../srs';
import { currentStreak, dayLog, finishDay, logDay, today, update, useProgress } from '../store';
import { Icon } from '../ui/icons';
import { HeartsBar, Lesson, type Answer } from '../ui/Lesson';

type Run = { kind: 'session' } | { kind: 'placement' } | { kind: 'practice'; title: string; exs: string[] };

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

  const onSessionAnswer = (stepKey: string) => ({ ex, ok }: Answer) => {
    if (stepKey === 'review') { grade(ex.id, ok ? 'good' : 'again'); logDay(d => { d.reviews++; }); }
    if (stepKey === 'learn' && isFinalLearnQuiz(ex)) { grade(ex.id, ok ? 'good' : 'again'); logDay(d => { d.learned++; }); }
    if (stepKey === 'listen' && isLearned(ex.id)) grade(ex.id, ok ? 'good' : 'again');
  };

  if (run?.kind === 'session') {
    const s = todaysSession();
    const step = s.steps[s.step];
    if (!step) { setRun(null); return null; }
    return (
      <Lesson
        key={`${s.date}-${s.step}`}
        title={STEPS[step.key].title}
        exs={step.ids}
        start={s.index}
        onAnswer={onSessionAnswer(step.key)}
        onProgress={index => update(p => { if (p.session) p.session = { ...p.session, index }; })}
        onDone={() => {
          const last = s.step + 1 >= s.steps.length;
          update(p => { if (p.session) p.session = { ...p.session, step: s.step + 1, index: 0 }; });
          if (last) {
            finishDay();
            scheduleReminders();
            setRun(null);
            setCelebrate(true);
          }
        }}
        onExit={() => setRun(null)}
      />
    );
  }

  if (run?.kind === 'placement') {
    return (
      <Lesson
        title="Quick check"
        exs={PLACEMENT}
        useHearts={false}
        dontKnow
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
        onAnswer={({ ex, ok }) => { if (isLearned(ex.id)) grade(ex.id, ok ? 'good' : 'again'); }}
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

      <section class="stats">
        <div class="stat"><b>{learned}</b><span>of {total} phrases learned</span></div>
        <div class="stat"><b>{due}</b><span>due for review</span></div>
      </section>

      <section class="block">
        <h3>Extra practice</h3>
        <div class="practice">
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
