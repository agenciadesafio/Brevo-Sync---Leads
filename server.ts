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
    "https://www.googleapis.com/auth/spreadsheets.readonly",
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

app.post("/api/contacts/sync", requireAuth, async (req, res) => {
  const { spreadsheetId, range, listId } = req.body;
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

    let syncedCount = 0;
    let errors = [];

    // 2. Sync to Brevo
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const email = row[emailIndex];
      const name = nameIndex !== -1 ? row[nameIndex] : "";
      const status = statusIndex !== -1 ? row[statusIndex] : "Ativo";

      if (!email) continue;

      // Only sync if status is not "Inativo" or something similar, or sync all and update attributes.
      // Let's just create/update the contact in Brevo.
      
      try {
        await axios.post(
          "https://api.brevo.com/v3/contacts",
          {
            email: email,
            attributes: {
              NOME: name,
              STATUS: status
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
      } catch (err: any) {
        console.error(`Failed to sync ${email}:`, err.response?.data || err.message);
        errors.push({ email, error: err.response?.data?.message || err.message });
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
    app.use(express.static(distPath));
    
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
