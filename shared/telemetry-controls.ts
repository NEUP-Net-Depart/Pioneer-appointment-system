import { knownControl } from './telemetry.ts';

// Static component parts, never labels, option values, dates or record identifiers.
export const CONTROL_COMPONENTS: Readonly<Partial<Record<string, { parts?: readonly string[]; children?: Readonly<Record<string, string>>; alias?: string }>>> = Object.freeze({
  Select: { parts: ['panel', 'search', 'option'] },
  DatePicker: {
    parts: ['trigger', 'panel', 'previous', 'next', 'mode', 'month', 'day', 'today', 'clear']
  },
  TimePicker: { parts: ['trigger', 'panel', 'adjust', 'confirm', 'cancel'] },
  DateTimePicker: { children: { date: 'DatePicker', time: 'TimePicker' } },
  WeekPicker: { parts: ['previous', 'next'], children: { date: 'DatePicker' } },
  CampusScope: {},
  ChoiceMenu: { alias: 'Select' },
  RefreshButton: {},
  HelpHint: { parts: ['panel'] }
});

export function componentControlIds(component: string, id: string): string[] {
  const definition = CONTROL_COMPONENTS[component];
  if (!definition) return [id];
  if (definition.alias) return componentControlIds(definition.alias, id);
  return [
    id,
    ...(definition.parts || []).map((part) => `${id}.${part}`),
    ...Object.entries(definition.children || {}).flatMap(([part, child]) =>
      componentControlIds(child, `${id}.${part}`)
    )
  ];
}

export function controlPart(id: string | null | undefined, part: string) {
  return knownControl(`${knownControl(id)}.${part}`);
}
