import { key, repairStages } from './roster-workflow-shared.js';
export function RosterStage({ stage }) {
  const steps = repairStages;
  const current =
    stage === 'scheduled' || stage === 'collecting' || stage === 'ready'
      ? 1
      : stage === 'published'
        ? 3
        : 2;
  return (
    <ol className="roster-steps" aria-label="排班流程">
      {steps.map((text, i) => (
        <li
          key={text}
          aria-current={i === current ? 'step' : undefined}
          data-complete={i < current}
        >
          <span>{i + 1}</span>
          {text}
        </li>
      ))}
    </ol>
  );
}
