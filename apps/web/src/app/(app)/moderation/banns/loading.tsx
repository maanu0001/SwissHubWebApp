import { TableSkeleton } from '@/components/shared/states';

/** Ladezustand der Bannliste - sie kommt von Discord und braucht einen Moment. */
export default function Loading(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <TableSkeleton rows={6} columns={4} />
    </div>
  );
}
