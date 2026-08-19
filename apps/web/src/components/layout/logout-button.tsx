import { LogOut } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';

/**
 * Abmelden per POST inklusive CSRF-Token.
 * Ein einfacher Link wuerde ein CSRF-Risiko darstellen.
 */
export function LogoutButton({
  csrfToken,
  variant = 'ghost',
  className,
}: {
  csrfToken: string;
  variant?: ButtonProps['variant'];
  className?: string;
}): React.JSX.Element {
  return (
    <form action="/api/auth/logout" method="post" className={className}>
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <Button type="submit" variant={variant} size="sm" className="w-full justify-start gap-2">
        <LogOut aria-hidden="true" />
        Abmelden
      </Button>
    </form>
  );
}
