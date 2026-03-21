import ReactDiffViewer from 'react-diff-viewer-continued';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

interface RunComparisonPanelProps {
  title: string;
  leftTitle: string;
  rightTitle: string;
  leftValue?: string;
  rightValue?: string;
  similarity?: number;
  diffCount?: number;
}

export function RunComparisonPanel({
  title,
  leftTitle,
  rightTitle,
  leftValue,
  rightValue,
  similarity,
  diffCount,
}: RunComparisonPanelProps) {
  if (!leftValue && !rightValue) {
    return null;
  }

  return (
    <Card className="border-border/70 bg-white">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">{title}</CardTitle>
          <div className="flex gap-2">
            {typeof similarity === 'number' ? <Badge variant="outline">{similarity}%</Badge> : null}
            {typeof diffCount === 'number' ? <Badge variant="secondary">{diffCount} diffs</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription>
            左侧是 {leftTitle}，右侧是 {rightTitle}。
          </AlertDescription>
        </Alert>
        <div className="overflow-hidden rounded-2xl border border-border/70">
          <ReactDiffViewer
            oldValue={leftValue || ''}
            newValue={rightValue || ''}
            splitView
            showDiffOnly={false}
            leftTitle={leftTitle}
            rightTitle={rightTitle}
            useDarkTheme={false}
          />
        </div>
      </CardContent>
    </Card>
  );
}
