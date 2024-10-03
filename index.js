const express = require("express");
const session = require("express-session");
const axios = require("axios");
const cors = require("cors");
const mongoose = require("mongoose");
const { QuickDB } = require("quick.db");
const db = new QuickDB();
// Connect to MongoDB
mongoose.connect(
  "mongodb+srv://info:v9fydB6nQpklDjiy@cluster0.ggc3kaf.mongodb.net/telegram?retryWrites=true&w=majority&appName=AtlasApp",
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  },
);

const websiteSchema = new mongoose.Schema({
  origin: { type: String, required: true },
  secret: { type: String, required: true },
});

const Website = mongoose.model("Website", websiteSchema);
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  accessToken: { type: String, required: true },
  ipAddress: { type: String, required: true },
  origin: { type: String, required: true }, // Add this to track which site the user is connected from
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true }, // Token expiration time
});

const User = mongoose.model("webuser", userSchema);

const app = express();

app.use(async (req, res, next) => {
  try {
    const websites = await Website.find();
    const allowedOrigins = websites.map((website) => website.origin);

    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      methods: ["GET", "POST"],
      credentials: true,
    })(req, res, next);
  } catch (error) {
    console.error("Error fetching allowed origins:", error);
    res.status(500).send("Internal server error");
  }
});

app.use(
  session({
    secret: async (req, res, next) => {
      try {
        const website = await Website.findOne({ origin: req.get("Origin") });
        return website ? website.secret : "default-secret";
      } catch (error) {
        console.error("Error fetching session secret:", error);
        return "default-secret"; // Fallback to a default secret
      }
    },
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  }),
);

app.get("/login", (req, res) => {
  const clientId = "1140017515993509949";
  const redirectUri = encodeURIComponent("http://198.199.72.118:2999/callback");
  const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify`;
  res.redirect(discordAuthUrl);
});

app.get("/callback", async (req, res) => {
  const code = req.query.code;
  const clientId = "1140017515993509949";
  const clientSecret = "n7__DV1OQzkphCYyqOi4vWDYzJvNSyF7";
  const redirectUri =
    "https://6f0e72c3-73ed-46a7-ba12-e029fd4f5c18-00-3k7omavtc52av.kirk.replit.dev/callback";

  try {
    const tokenResponse = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: redirectUri,
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );

    const accessToken = tokenResponse.data.access_token;

    const userResponse = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // Get and clean user IP
    const userIp =
      req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    const cleanedUserIp = userIp
      .split(",")
      .map((ip) => ip.trim())
      .join(", ");

    // Fetch existing user
    let user = await User.findOne({ userId: userResponse.data.id });
    const origin = req.get("Origin"); // Capture the origin site

    const expirationTime = new Date();
    expirationTime.setHours(expirationTime.getHours() + 24); // Token valid for 24 hours

    if (user) {
      // Check if the IP address is different
      if (user.ipAddress !== cleanedUserIp) {
        console.log(
          `IP mismatch detected. Old IP: ${user.ipAddress}, New IP: ${cleanedUserIp}. Deleting previous session.`,
        );

        // Delete the previous session by removing the user entry
        await User.deleteOne({ userId: user.userId });

        // Create a new user entry with the new IP address
        user = new User({
          userId: userResponse.data.id,
          accessToken: accessToken,
          ipAddress: cleanedUserIp,
          origin: origin, // Save the origin site
          expiresAt: expirationTime, // Set expiration time
        });
      } else {
        // Update the access token if the IP matches
        user.accessToken = accessToken;
        user.expiresAt = expirationTime; // Reset expiration time
      }
    } else {
      // If no user exists, create a new one
      user = new User({
        userId: userResponse.data.id,
        accessToken: accessToken,
        ipAddress: cleanedUserIp,
        origin: origin, // Save the origin site
        expiresAt: expirationTime, 
      });
    }

    // Save the user
    await user.save();

    res.redirect(
      `https://gabriels-fantabulous-site-fceee7.webflow.io/dashboard?token=${accessToken}`,
    );
  } catch (error) {
    console.error("Error during login process:", error);
    res.status(500).send("Error during login process");
  }
});

app.listen(80, () => {
  console.log("Custom login site running on port 80");
});

app.get("/verify-token", async (req, res) => {
  const token = req.query.token;
  const userIp = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
  const currentOrigin = req.get("Origin");
  if (!token) {
    return res.status(401).json({ valid: false, message: "No token provided" });
  }

  try {
    const user = await User.findOne({ accessToken: token });

    if (user) {
      if (new Date() > user.expiresAt) {
        return res.status(401).json({ valid: false, message: "Token expired" });
      }

      const currentIps = userIp.split(",").map((ip) => ip.trim());
      const savedIps = user.ipAddress.split(",").map((ip) => ip.trim());
      const originMatch = user.origin === currentOrigin; // Check if the origin matches

      const ipMatch = savedIps.some((ip) => currentIps.includes(ip));

      if (ipMatch && originMatch) {
        res.status(200).json({ valid: true, userId: user.userId });
      } else {
        res.status(401).json({
          valid: false,
          message: "IP mismatch, reauthentication required",
        });
      }
    } else {
      res
        .status(401)
        .json({ valid: false, message: "Invalid or expired token" });
    }
  } catch (error) {
    console.error("Error verifying token:", error);
    res.status(500).json({ valid: false, message: "Error verifying token" });
  }
});
