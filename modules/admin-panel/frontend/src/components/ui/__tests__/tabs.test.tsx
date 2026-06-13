import { TabsContent } from '@/components/ui/tabs';
import type React from 'react';

describe('TabsContent', () => {
  it('keeps inactive panels hidden even when callers add flex layout classes', () => {
    const element = (TabsContent as unknown as {
      render: (props: { className?: string }, ref: React.Ref<unknown>) => { props: { className: string } };
    }).render({ className: 'flex min-h-0 flex-1 flex-col' }, null);

    expect(element.props.className).toContain('data-[state=inactive]:hidden');
    expect(element.props.className).toContain('flex min-h-0 flex-1 flex-col');
  });
});
