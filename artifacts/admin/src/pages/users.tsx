import { useQuery } from "@tanstack/react-query";
import { Users, RefreshCw, CheckCircle, XCircle, Cpu, Zap } from "lucide-react";
import { apiFetch, type AdminUser } from "@/lib/api";
import { formatDate, shortUserId } from "@/lib/utils";

function Badge({ active, label, activeLabel }: { active: boolean; label: string; activeLabel: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
      active
        ? "bg-success/10 text-success"
        : "bg-muted text-muted-foreground"
    }`}>
      {active ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {active ? activeLabel : label}
    </span>
  );
}

export default function UsersPage() {
  const { data: users = [], isLoading, refetch, isFetching } = useQuery<AdminUser[]>({
    queryKey: ["admin-users"],
    queryFn: () => apiFetch("/admin/users"),
    refetchInterval: 60000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            User Management
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{users.length} registered accounts</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-md px-3 py-1.5 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-card border border-card-border rounded-lg h-16 animate-pulse" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="bg-card border border-card-border rounded-lg p-12 text-center">
          <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No users found</p>
          <p className="text-xs text-muted-foreground mt-1">Users appear here after they sign in and save settings</p>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="table-header-cell text-left px-4 py-3">User ID</th>
                  <th className="table-header-cell text-left px-4 py-3">Broker</th>
                  <th className="table-header-cell text-center px-4 py-3">Auto Trade</th>
                  <th className="table-header-cell text-center px-4 py-3">Kill Switch</th>
                  <th className="table-header-cell text-center px-4 py-3">Auto SQ</th>
                  <th className="table-header-cell text-right px-4 py-3">Orders</th>
                  <th className="table-header-cell text-left px-4 py-3">Token At</th>
                  <th className="table-header-cell text-left px-4 py-3">Updated</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-border/50 table-row-hover">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-primary">
                            {user.userId ? user.userId[0].toUpperCase() : "?"}
                          </span>
                        </div>
                        <div>
                          <p className="text-xs font-mono text-foreground">{shortUserId(user.userId)}</p>
                          <p className="text-xs text-muted-foreground">{user.theme} theme</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {user.brokerClientId ? (
                        <div className="flex items-center gap-1">
                          <Cpu className="w-3 h-3 text-success" />
                          <span className="text-xs font-mono text-foreground">
                            ****{user.brokerClientId.slice(-4)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not configured</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge active={user.enableAutoTrading} label="Off" activeLabel="On" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge active={user.killSwitchEnabled} label="Off" activeLabel="Active" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge active={user.autoSquareOffEnabled} label="Off" activeLabel="On" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center gap-1 text-sm font-medium text-foreground">
                        <Zap className="w-3 h-3 text-primary" />
                        {user.superOrderCount}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground">{formatDate(user.tokenGeneratedAt)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground">{formatDate(user.updatedAt)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
