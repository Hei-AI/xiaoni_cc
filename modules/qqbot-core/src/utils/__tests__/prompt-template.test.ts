import { renderPromptTemplate } from '../prompt-template';

describe('renderPromptTemplate', () => {
  it('renders moustache and template literal variables', () => {
    const rendered = renderPromptTemplate(
      'hello {{name}} / ${role}',
      { name: '小腻' },
      { role: 'planner' }
    );

    expect(rendered).toBe('hello 小腻 / planner');
  });

  it('keeps unknown variables untouched', () => {
    const rendered = renderPromptTemplate('hello {{missing}} / ${unknown}', {}, {});

    expect(rendered).toBe('hello {{missing}} / ${unknown}');
  });

  it('renders now helpers', () => {
    const rendered = renderPromptTemplate('{{now.iso}}|{{now.date}}|{{now.time}}|{{now.locale}}');
    const parts = rendered.split('|');

    expect(parts).toHaveLength(4);
    expect(parts[0]).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(parts[1].length).toBeGreaterThan(0);
    expect(parts[2].length).toBeGreaterThan(0);
    expect(parts[3].length).toBeGreaterThan(0);
  });

  it('serializes json-like values without dropping null', () => {
    const rendered = renderPromptTemplate(
      '{{payload}}|{{nullable}}',
      { payload: { ok: true }, nullable: null },
      {}
    );

    expect(rendered).toBe('{"ok":true}|null');
  });
});
