import express from "express";
import cookieParser from "cookie-parser";
import { createServer as createViteServer } from "vite";
import { google } from "googleapis";
import jwt from "jsonwebtoken";
import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(express.json());
app.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-for-dev-only";
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${APP_URL}/auth/callback`
);

// Middleware to verify JWT and set Google credentials
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid token" });
  }
};

// --- API Routes ---

app.get("/api/auth/url", (req, res) => {
  const scopes = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent",
  });

  res.json({ url });
});

app.get("/auth/callback", async (req, res) => {
  const code = req.query.code as string;
  
  if (!code) {
    return res.status(400).send("No code provided");
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    // Create JWT with tokens and user info
    const token = jwt.sign(
      {
        tokens,
        user: {
          id: userInfo.data.id,
          email: userInfo.data.email,
          name: userInfo.data.name,
          picture: userInfo.data.picture,
        },
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error exchanging code for tokens:", error);
    res.status(500).send("Authentication failed");
  }
});

app.get("/api/auth/status", (req, res) => {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.json({ authenticated: false });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    res.json({ authenticated: true, user: decoded.user });
  } catch (error) {
    res.json({ authenticated: false });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("auth_token", {
    httpOnly: true,
    secure: true,
    sameSite: "none",
  });
  res.json({ success: true });
});

app.get("/api/brevo/lists", requireAuth, async (req, res) => {
  if (!process.env.BREVO_API_KEY) {
    return res.status(500).json({ error: "BREVO_API_KEY is not configured on the server" });
  }

  try {
    const response = await axios.get("https://api.brevo.com/v3/contacts/lists", {
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "accept": "application/json"
      }
    });
    
    // Brevo returns lists inside a `lists` array
    res.json({ success: true, lists: response.data.lists });
  } catch (error: any) {
    console.error("Fetch lists error:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.message || "Failed to fetch lists" });
  }
});

// Helper function to convert column index to letter (0 -> A, 1 -> B, 26 -> AA)
function getColumnLetter(colIndex: number) {
  let letter = '';
  while (colIndex >= 0) {
    letter = String.fromCharCode((colIndex % 26) + 65) + letter;
    colIndex = Math.floor(colIndex / 26) - 1;
  }
  return letter;
}

app.post("/api/contacts/sync", requireAuth, async (req, res) => {
  const { spreadsheetId, range, listId, listName, notificationEmails } = req.body;
  const user = (req as any).user;

  if (!spreadsheetId || !range || !listId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  if (!process.env.BREVO_API_KEY) {
    return res.status(500).json({ error: "BREVO_API_KEY is not configured on the server" });
  }

  try {
    // 1. Fetch data from Google Sheets
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    client.setCredentials(user.tokens);

    const sheets = google.sheets({ version: "v4", auth: client });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return res.json({ success: true, message: "No data found in the sheet.", synced: 0 });
    }

    // Assume first row is header
    const headers = rows[0].map((h: string) => h.toLowerCase());
    const emailIndex = headers.indexOf("email");
    const nameIndex = headers.indexOf("nome") !== -1 ? headers.indexOf("nome") : headers.indexOf("name");
    const statusIndex = headers.indexOf("status");

    if (emailIndex === -1) {
      return res.status(400).json({ error: "Sheet must contain an 'email' column." });
    }
    
    if (statusIndex === -1) {
      return res.status(400).json({ error: "Sheet must contain a 'status' column para ler os leads novos." });
    }

    let syncedCount = 0;
    let errors = [];
    const rowsToUpdate: number[] = [];
    const sheetName = range.includes('!') ? range.split('!')[0] : range;
    const statusColLetter = getColumnLetter(statusIndex);

    // 2. Sync to Brevo
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const email = row[emailIndex];
      const name = nameIndex !== -1 ? row[nameIndex] : "";
      const status = row[statusIndex] || "";

      // Ler somente se o status estiver como "novo"
      if (!email || status.toLowerCase() !== "novo") continue;

      try {
        await axios.post(
          "https://api.brevo.com/v3/contacts",
          {
            email: email,
            attributes: {
              NOME: name,
              STATUS: "Inserido"
            },
            listIds: [parseInt(listId)],
            updateEnabled: true
          },
          {
            headers: {
              "api-key": process.env.BREVO_API_KEY,
              "Content-Type": "application/json",
              "accept": "application/json"
            }
          }
        );
        syncedCount++;
        rowsToUpdate.push(i); // Guarda o índice da linha para atualizar depois
      } catch (err: any) {
        console.error(`Failed to sync ${email}:`, err.response?.data || err.message);
        errors.push({ email, error: err.response?.data?.message || err.message });
      }
    }

    // 3. Update Google Sheets Status
    if (rowsToUpdate.length > 0) {
      const dataToUpdate = rowsToUpdate.map(rowIndex => ({
        range: `${sheetName}!${statusColLetter}${rowIndex + 1}`,
        values: [['Inserido']]
      }));

      try {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: dataToUpdate
          }
        });
      } catch (sheetErr) {
        console.error("Failed to update Google Sheets status:", sheetErr);
      }
    }

    // 4. Send Notification Email
    if (notificationEmails && syncedCount > 0) {
      const emailList = notificationEmails.split(',').map((e: string) => ({ email: e.trim() })).filter((e: any) => e.email);
      if (emailList.length > 0) {
        try {
          await axios.post(
            "https://api.brevo.com/v3/smtp/email",
            {
              sender: { name: "Sistema de Leads", email: "noreply@desafioweb.com.br" },
              to: emailList,
              subject: "Sincronização de Leads Concluída",
              htmlContent: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                  <h2 style="color: #0f172a;">Sincronização Concluída com Sucesso!</h2>
                  <p>A sincronização de leads da sua planilha para o Brevo foi finalizada.</p>
                  <ul style="background: #f8fafc; padding: 20px; border-radius: 8px; list-style: none;">
                    <li style="margin-bottom: 10px;"><strong>Planilha Utilizada:</strong> <a href="https://docs.google.com/spreadsheets/d/${spreadsheetId}" style="color: #2563eb;">Acessar Planilha</a></li>
                    <li style="margin-bottom: 10px;"><strong>Lista no Brevo:</strong> ${listName || listId}</li>
                    <li><strong>Leads Atualizados:</strong> ${syncedCount}</li>
                  </ul>
                  <p>Os leads com status "novo" foram processados e atualizados para "Inserido" na planilha.</p>
                </div>
              `
            },
            {
              headers: {
                "api-key": process.env.BREVO_API_KEY,
                "Content-Type": "application/json",
                "accept": "application/json"
              }
            }
          );
        } catch (emailErr: any) {
          console.error("Failed to send notification email:", emailErr.response?.data || emailErr.message);
        }
      }
    }

    res.json({ 
      success: true, 
      synced: syncedCount, 
      errors: errors.length > 0 ? errors : undefined 
    });

  } catch (error: any) {
    console.error("Sync error:", error);
    res.status(500).json({ error: error.message || "Failed to sync contacts" });
  }
});

app.post("/api/contacts/add", requireAuth, async (req, res) => {
  const { email, name, status, listId } = req.body;

  if (!email || !listId) {
    return res.status(400).json({ error: "Email and List ID are required" });
  }

  if (!process.env.BREVO_API_KEY) {
    return res.status(500).json({ error: "BREVO_API_KEY is not configured on the server" });
  }

  try {
    await axios.post(
      "https://api.brevo.com/v3/contacts",
      {
        email: email,
        attributes: {
          NOME: name || "",
          STATUS: status || "Ativo"
        },
        listIds: [parseInt(listId)],
        updateEnabled: true
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json",
          "accept": "application/json"
        }
      }
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error("Add contact error:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.message || "Failed to add contact" });
  }
});


// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Force correct MIME types for production static files
    const distPath = path.join(__dirname, "dist");
    
    // Serve static files with correct MIME types automatically
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
          res.setHeader('Content-Type', 'application/javascript');
        } else if (filePath.endsWith('.css')) {
          res.setHeader('Content-Type', 'text/css');
        } else if (filePath.endsWith('.svg')) {
          res.setHeader('Content-Type', 'image/svg+xml');
        }
      }
    }));
    
    // SPA Fallback for React Router
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
