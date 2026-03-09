import { usePermissions } from "@/_core/hooks/usePermissions";
import { Forbidden } from "@/components/Forbidden";
import { Loader2, AlertCircle } from "lucide-react";

interface PermissionGuardProps {
  permission?: string;
  roles?: string[];
  children: React.ReactNode;
}

export function PermissionGuard({ permission, roles, children }: PermissionGuardProps) {
  const { role, can, isLoading, error } = usePermissions();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // If the permissions query failed with a non-FORBIDDEN error, show the real error
  if (error) {
    const code = (error as any)?.data?.code;
    if (code !== "FORBIDDEN") {
      return (
        <div className="flex items-center justify-center min-h-[50vh] p-4">
          <div className="w-full max-w-md border border-destructive/20 rounded-lg shadow-lg p-6 text-center space-y-3">
            <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
            <h2 className="text-lg font-semibold text-destructive">Error al verificar permisos</h2>
            <p className="text-sm text-muted-foreground">{error.message}</p>
          </div>
        </div>
      );
    }
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
