import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from './states';
import { cn } from '@/lib/utils';

export interface DataTableColumn<TRow> {
  key: string;
  header: React.ReactNode;
  className?: string;
  render(row: TRow): React.ReactNode;
}

interface DataTableProps<TRow> {
  columns: Array<DataTableColumn<TRow>>;
  rows: TRow[];
  getRowKey(row: TRow): string;
  emptyTitle?: string;
  emptyDescription?: string;
  caption?: string;
}

/** Wiederverwendbare Tabelle mit Leerzustand. */
export function DataTable<TRow>({
  columns,
  rows,
  getRowKey,
  emptyTitle = 'Keine Einträge',
  emptyDescription,
  caption,
}: DataTableProps<TRow>): React.JSX.Element {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <Table>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className={column.className}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={getRowKey(row)}>
              {columns.map((column) => (
                <TableCell key={column.key} className={cn(column.className)}>
                  {column.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
