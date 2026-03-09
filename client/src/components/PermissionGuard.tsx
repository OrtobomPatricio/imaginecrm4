import { usePermissions } from "@/_core/hooks/usePermissions";
import { Forbidden } from "@/components/Forbidden";
import { Loader2 } from "lucide-react";

interface PermissionGuardProps {
  permission?: string;
  roles?: string[];
  children: React.ReactNode;
}

export function PermissionGuard({ permission, roles, children }: PermissionGuardProps) {
  const { role, can, isLoading } = usePermissions();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Hard role gate
  if (roles && roles.length > 0) {
    if (!role || !roles.includes(role)) {
      return <Forbidden />;
    }
  }

  // Permission gate
  if (permission) {
    if (!can(permission)) return <Forbidden />;
  }

  return <>{children}</>;
}
