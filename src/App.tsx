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
  const [range, setRange] = useState("Página1");
  const [listId, setListId] = useState("");
  const [notificationEmails, setNotificationEmails] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string; synced?: number } | null>(null);

  // Manual Add Form State
  const [manualEmail, setManualEmail] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualStatus, setManualStatus] = useState("Ativo");
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<{ success: boolean; message: string } | null>(null);

  // Brevo Lists State
  const [brevoLists, setBrevoLists] = useState<any[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);

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

  useEffect(() => {
    if (isAuthenticated) {
      fetchBrevoLists();
    }
  }, [isAuthenticated]);

  const fetchBrevoLists = async () => {
    setLoadingLists(true);
    try {
      const res = await fetch("/api/brevo/lists");
      const data = await res.json();
      if (data.success && data.lists) {
        setBrevoLists(data.lists);
        if (data.lists.length > 0 && !listId) {
          setListId(data.lists[0].id.toString());
        }
      }
    } catch (error) {
      console.error("Failed to fetch Brevo lists", error);
    } finally {
      setLoadingLists(false);
    }
  };

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

    // Extrai o ID se o usuário colar o link completo da planilha
    let finalSpreadsheetId = spreadsheetId;
    const match = spreadsheetId.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
      finalSpreadsheetId = match[1];
    }

    // Se o usuário digitou apenas o nome da aba, adiciona o intervalo padrão
    let finalRange = range;
    if (!range.includes('!')) {
      finalRange = `${range}!A:Z`;
    }

    const selectedList = brevoLists.find(l => l.id.toString() === listId);
    const listName = selectedList ? selectedList.name : "";

    try {
      const res = await fetch("/api/contacts/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          spreadsheetId: finalSpreadsheetId, 
          range: finalRange, 
          listId, 
          listName, 
          notificationEmails 
        }),
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
                  <Label htmlFor="spreadsheetId">Link ou ID da Planilha</Label>
                  <Input 
                    id="spreadsheetId" 
                    placeholder="Cole o link completo da planilha do Google" 
                    value={spreadsheetId}
                    onChange={(e) => setSpreadsheetId(e.target.value)}
                    required
                  />
                  <p className="text-xs text-slate-500">Você pode colar a URL inteira da planilha.</p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="range">Nome da Aba (Página)</Label>
                  <Input 
                    id="range" 
                    placeholder="Ex: Página1" 
                    value={range}
                    onChange={(e) => setRange(e.target.value)}
                    required
                  />
                  <p className="text-xs text-slate-500">A planilha deve ter colunas 'email', 'nome' e 'status'.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="listId">Lista no Brevo</Label>
                  <div className="relative">
                    <select
                      id="listId"
                      className="flex h-10 w-full items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                      value={listId}
                      onChange={(e) => setListId(e.target.value)}
                      required
                      disabled={loadingLists || brevoLists.length === 0}
                    >
                      <option value="" disabled>
                        {loadingLists ? "Carregando listas..." : "Selecione uma lista"}
                      </option>
                      {brevoLists.map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.name} (ID: {list.id})
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-50"><path d="M4.93179 5.43179C4.75605 5.60753 4.75605 5.89245 4.93179 6.06819C5.10753 6.24392 5.39245 6.24392 5.56819 6.06819L7.49999 4.13638L9.43179 6.06819C9.60753 6.24392 9.89245 6.24392 10.0682 6.06819C10.2439 5.89245 10.2439 5.60753 10.0682 5.43179L7.81819 3.18179C7.73379 3.0974 7.61933 3.04999 7.49999 3.04999C7.38064 3.04999 7.26618 3.0974 7.18179 3.18179L4.93179 5.43179ZM10.0682 9.56819C10.2439 9.39245 10.2439 9.10753 10.0682 8.93179C9.89245 8.75605 9.60753 8.75605 9.43179 8.93179L7.49999 10.8636L5.56819 8.93179C5.39245 8.75605 5.10753 8.75605 4.93179 8.93179C4.75605 9.10753 4.75605 9.39245 4.93179 9.56819L7.18179 11.8182C7.26618 11.9026 7.38064 11.95 7.49999 11.95C7.61933 11.95 7.73379 11.9026 7.81819 11.8182L10.0682 9.56819Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"></path></svg>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notificationEmails">Emails para Notificação (Opcional)</Label>
                  <Input 
                    id="notificationEmails" 
                    placeholder="email1@exemplo.com, email2@exemplo.com" 
                    value={notificationEmails}
                    onChange={(e) => setNotificationEmails(e.target.value)}
                  />
                  <p className="text-xs text-slate-500">Separe múltiplos emails por vírgula. Eles receberão um resumo da sincronização.</p>
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
                  <Label htmlFor="manualListId">Lista no Brevo</Label>
                  <div className="relative">
                    <select
                      id="manualListId"
                      className="flex h-10 w-full items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                      value={listId}
                      onChange={(e) => setListId(e.target.value)}
                      required
                      disabled={loadingLists || brevoLists.length === 0}
                    >
                      <option value="" disabled>
                        {loadingLists ? "Carregando listas..." : "Selecione uma lista"}
                      </option>
                      {brevoLists.map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.name} (ID: {list.id})
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-50"><path d="M4.93179 5.43179C4.75605 5.60753 4.75605 5.89245 4.93179 6.06819C5.10753 6.24392 5.39245 6.24392 5.56819 6.06819L7.49999 4.13638L9.43179 6.06819C9.60753 6.24392 9.89245 6.24392 10.0682 6.06819C10.2439 5.89245 10.2439 5.60753 10.0682 5.43179L7.81819 3.18179C7.73379 3.0974 7.61933 3.04999 7.49999 3.04999C7.38064 3.04999 7.26618 3.0974 7.18179 3.18179L4.93179 5.43179ZM10.0682 9.56819C10.2439 9.39245 10.2439 9.10753 10.0682 8.93179C9.89245 8.75605 9.60753 8.75605 9.43179 8.93179L7.49999 10.8636L5.56819 8.93179C5.39245 8.75605 5.10753 8.75605 4.93179 8.93179C4.75605 9.10753 4.75605 9.39245 4.93179 9.56819L7.18179 11.8182C7.26618 11.9026 7.38064 11.95 7.49999 11.95C7.61933 11.95 7.73379 11.9026 7.81819 11.8182L10.0682 9.56819Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"></path></svg>
                    </div>
                  </div>
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
