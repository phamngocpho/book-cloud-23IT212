require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const { MongoClient } = require("mongodb");

const MSSV = "23IT212";
const HO_TEN = "Phạm Ngọc Phổ";
const PREFIX = MSSV.slice(-3);          // 212
const VAT_PERCENT = Number(MSSV.slice(-1)) + 6; // 8
const DB_NAME = process.env.DB_NAME;

const app = express();
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "hbs");
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  res.locals.hoTen = HO_TEN;
  res.locals.mssv = MSSV;
  res.locals.vat = VAT_PERCENT;
  res.locals.prefix = PREFIX;
  next();
});

let booksRead;
let booksWrite;

function requireEnv(name) {
  if (!process.env[name]) {
    throw new Error("Thieu bien moi truong " + name);
  }
  return process.env[name];
}

async function main() {
  const readClient = new MongoClient(requireEnv("MONGO_READ_URI"));
  const writeClient = new MongoClient(requireEnv("MONGO_WRITE_URI"));
  await readClient.connect();
  await writeClient.connect();

  booksRead = readClient.db(DB_NAME).collection("books");
  booksWrite = writeClient.db(DB_NAME).collection("books");

  // Luu session tap trung tren MongoDB Atlas dung MongoStore
  app.use(session({
    secret: requireEnv("SESSION_SECRET"),
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      client: writeClient,
      dbName: DB_NAME,
      collectionName: "sessions",
      ttl: 60 * 60 * 24,
      autoRemove: "interval"
    }),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24
    }
  }));

  app.get("/", async (req, res, next) => {
    try {
      req.session.visits = (req.session.visits || 0) + 1;
      const books = await booksRead.find({}).sort({ createdAt: -1 }).toArray();
      res.render("index", {
        books,
        visits: req.session.visits,
        sessionId: req.sessionID,
        error: null
      });
    } catch (err) {
      next(err);
    }
  });

  app.post("/books", async (req, res, next) => {
    try {
      const maSach = String(req.body.maSach || "").trim();
      const tenSach = String(req.body.tenSach || "").trim();
      const giaGoc = Number(req.body.giaGoc);

      if (!maSach.startsWith(PREFIX)) {
        const books = await booksRead.find({}).sort({ createdAt: -1 }).toArray();
        return res.status(400).render("index", {
          books,
          visits: req.session.visits,
          sessionId: req.sessionID,
          error: "Mã sản phẩm phải bắt đầu bằng " + PREFIX + ". Hệ thống từ chối."
        });
      }
      if (!tenSach || !Number.isFinite(giaGoc) || giaGoc < 0) {
        const books = await booksRead.find({}).sort({ createdAt: -1 }).toArray();
        return res.status(400).render("index", {
          books,
          visits: req.session.visits,
          sessionId: req.sessionID,
          error: "Tên sách và giá gốc không hợp lệ."
        });
      }

      const giaSauThue = Math.round(giaGoc * (1 + VAT_PERCENT / 100));
      await booksWrite.insertOne({
        maSach,
        tenSach,
        giaGoc,
        vatPercent: VAT_PERCENT,
        giaSauThue,
        createdAt: new Date()
      });
      req.session.lastBook = maSach;
      res.redirect("/");
    } catch (err) {
      next(err);
    }
  });

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send("Loi he thong");
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log("Server running at port " + port);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});