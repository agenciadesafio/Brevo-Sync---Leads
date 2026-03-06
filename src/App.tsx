import React, { useEffect, useState } from "react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./components/ui/card";
import { RefreshCw, UserPlus, LogIn, LogOut, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "./lib/utils";

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Sync Form State
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [range, setRange] = useState("Página1!A:C");
  const [listId, setListId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string; synced?: number } | null>(null);

  // Manual Add Form State
  const [manualEmail, setManualEmail] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualStatus, setManualStatus] = useState("Ativo");
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    checkAuthStatus();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "OAUTH_AUTH_SUCCESS") {
        checkAuthStatus();
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const checkAuthStatus = async () => {
    try {
      const res = await fetch("/api/auth/status");
      const data = await res.json();
      setIsAuthenticated(data.authenticated);
      setUser(data.user);
    } catch (error) {
      console.error("Auth check failed", error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    try {
      const res = await fetch("/api/auth/url");
      const { url } = await res.json();
      window.open(url, "oauth_popup", "width=600,height=700");
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setIsAuthenticated(false);
      setUser(null);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const handleSync = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncing(true);
    setSyncResult(null);

    try {
      const res = await fetch("/api/contacts/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetId, range, listId }),
      });
      const data = await res.json();
      
      if (data.success) {
        setSyncResult({ success: true, message: `Sincronização concluída! ${data.synced} contatos atualizados.`, synced: data.synced });
      } else {
        setSyncResult({ success: false, message: data.error || "Erro na sincronização." });
      }
    } catch (error) {
      setSyncResult({ success: false, message: "Erro de rede ao sincronizar." });
    } finally {
      setSyncing(false);
    }
  };

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddResult(null);

    try {
      const res = await fetch("/api/contacts/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: manualEmail, name: manualName, status: manualStatus, listId }),
      });
      const data = await res.json();
      
      if (data.success) {
        setAddResult({ success: true, message: "Contato adicionado com sucesso!" });
        setManualEmail("");
        setManualName("");
      } else {
        setAddResult({ success: false, message: data.error || "Erro ao adicionar contato." });
      }
    } catch (error) {
      setAddResult({ success: false, message: "Erro de rede ao adicionar." });
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50">Carregando...</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Brevo Sync</CardTitle>
            <CardDescription>Sincronize contatos do Google Sheets para o Brevo</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button onClick={handleLogin} className="w-full flex items-center gap-2">
              <LogIn className="w-4 h-4" />
              Entrar com Google
            </Button>
          </CardContent>
          <CardFooter className="text-sm text-center text-slate-500">
            Necessário para ler as planilhas do Google.
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Brevo Contact Sync</h1>
            <p className="text-slate-500">Logado como {user?.email}</p>
          </div>
          <Button variant="outline" onClick={handleLogout} className="flex items-center gap-2">
            <LogOut className="w-4 h-4" />
            Sair
          </Button>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Sincronização em Lote */}
          <Card>
            <CardHeader>
              <CardTitle>Sincronizar Planilha</CardTitle>
              <CardDescription>
                Leia uma planilha do Google e atualize os contatos no Brevo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSync} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="spreadsheetId">ID da Planilha</Label>
                  <Input 
                    id="spreadsheetId" 
                    placeholder="Ex: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms" 
                    value={spreadsheetId}
                    onChange={(e) => setSpreadsheetId(e.target.value)}
                    required
                  />
                  <p className="text-xs text-slate-500">Encontrado na URL da planilha.</p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="range">Intervalo (Range)</Label>
                  <Input 
                    id="range" 
                    placeholder="Ex: Página1!A:C" 
                    value={range}
                    onChange={(e) => setRange(e.target.value)}
                    required
                  />
                  <p className="text-xs text-slate-500">A planilha deve ter colunas 'email', 'nome' e 'status'.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="listId">ID da Lista no Brevo</Label>
                  <Input 
                    id="listId" 
                    type="number"
                    placeholder="Ex: 2" 
                    value={listId}
                    onChange={(e) => setListId(e.target.value)}
                    required
                  />
                </div>

                {syncResult && (
                  <div className={cn("p-3 rounded-md flex items-start gap-2 text-sm", syncResult.success ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
                    {syncResult.success ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <AlertCircle className="w-4 h-4 mt-0.5" />}
                    <span>{syncResult.message}</span>
                  </div>
                )}

                <Button type="submit" disabled={syncing} className="w-full flex items-center gap-2">
                  <RefreshCw className={cn("w-4 h-4", syncing && "animate-spin")} />
                  {syncing ? "Sincronizando..." : "Atualizar Contatos"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Inclusão Manual */}
          <Card>
            <CardHeader>
              <CardTitle>Inclusão Manual</CardTitle>
              <CardDescription>
                Adicione ou atualize um único contato no Brevo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleManualAdd} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="manualEmail">Email</Label>
                  <Input 
                    id="manualEmail" 
                    type="email"
                    placeholder="joao@exemplo.com" 
                    value={manualEmail}
                    onChange={(e) => setManualEmail(e.target.value)}
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="manualName">Nome</Label>
                  <Input 
                    id="manualName" 
                    placeholder="João Silva" 
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="manualStatus">Status</Label>
                  <Input 
                    id="manualStatus" 
                    placeholder="Ativo" 
                    value={manualStatus}
                    onChange={(e) => setManualStatus(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="manualListId">ID da Lista no Brevo</Label>
                  <Input 
                    id="manualListId" 
                    type="number"
                    placeholder="Ex: 2" 
                    value={listId}
                    onChange={(e) => setListId(e.target.value)}
                    required
                  />
                </div>

                {addResult && (
                  <div className={cn("p-3 rounded-md flex items-start gap-2 text-sm", addResult.success ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
                    {addResult.success ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <AlertCircle className="w-4 h-4 mt-0.5" />}
                    <span>{addResult.message}</span>
                  </div>
                )}

                <Button type="submit" disabled={adding} variant="secondary" className="w-full flex items-center gap-2">
                  <UserPlus className="w-4 h-4" />
                  {adding ? "Adicionando..." : "Adicionar Contato"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
