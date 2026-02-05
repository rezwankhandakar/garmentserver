

const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

const app = express();
const port = process.env.PORT || 5000;

// ---------------- Firebase Admin ----------------
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

// ---------------- Middleware ----------------
app.use(cors());
app.use(express.json());

// ---------------- MongoDB ----------------
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fu1n5ti.mongodb.net/garmentOpsDB?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let userCollection;
let productCollection;

async function run() {
  try {
    await client.connect();
    const db = client.db("garmentDB");
    userCollection = db.collection("user");
    productCollection = db.collection("products");

    console.log("✅ MongoDB connected");

    // ---------------- Firebase Token Verify ----------------
    const verifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: "Unauthorized" });
      }

      try {
        const token = authHeader.split(" ")[1];
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded_email = decoded.email;
        next();
      } catch (err) {
        return res.status(401).send({ message: "Unauthorized" });
      }
    };

    // ---------------- Verify Admin ----------------
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await userCollection.findOne({ email });

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden access" });
      }
      next();
    };

    // ---------------- Verify Manager ----------------
    const verifyManager = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await userCollection.findOne({ email });

      if (!user) return res.status(401).send({ message: "Unauthorized" });
      if (user.role !== "manager" || user.status !== "approved") {
        return res.status(403).send({ message: "Forbidden" });
      }
      next();
    };

    // =====================================================
    // 👤 USERS API
    // =====================================================

    // Add user (signup/login time)
    app.post("/user", async (req, res) => {
      const userData = req.body;
      if (!userData.email) {
        return res.status(400).send({ message: "Email required" });
      }

      const existingUser = await userCollection.findOne({
        email: userData.email,
      });

      if (existingUser) {
        return res.send({ inserted: false, message: "User exists" });
      }

      const result = await userCollection.insertOne({
        ...userData,
        role: "buyer",
        status: "pending",
        createdAt: new Date(),
      });

      res.send({ inserted: true, userId: result.insertedId });
    });

    // 🔥 GET ALL USERS (ADMIN ONLY)  ← ManageUsers uses this
    app.get("/user", verifyFBToken, verifyAdmin, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    // Get role & status
    app.get("/user/:email/role", verifyFBToken, async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });

      res.send({
        role: user?.role || "buyer",
        status: user?.status || "pending",
      });
    });

    // Update role
    app.patch("/user/role/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;

      const result = await userCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      );

      res.send(result);
    });

    // Update status
    app.patch(
      "/user/status/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;

        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        res.send(result);
      }
    );

    // =====================================================
    // 📦 PRODUCTS
    // =====================================================
    app.post(
      "/products",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        const product = req.body;

        if (
          !product.title ||
          !product.description ||
          !product.category ||
          !product.price ||
          !product.quantity ||
          !product.moq ||
          !product.paymentOption ||
          !product.images?.length
        ) {
          return res.status(400).send({ message: "Missing fields" });
        }

        const newProduct = {
          ...product,
          createdBy: req.decoded_email,
          status: "active",
          createdAt: new Date(),
        };

        const result = await productCollection.insertOne(newProduct);
        res.send({ success: true, insertedId: result.insertedId });
      }
    );



// HOME PRODUCTS
app.get("/products/home", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;

    const products = await productCollection
      .find({ showHome: true, status: "active" })
      .limit(limit)
      .sort({ createdAt: -1 })
      .toArray();

    res.send(products);
  } catch (error) {
    res.status(500).send({ message: "Failed to load home products" });
  }
});


// ALL PRODUCTS
app.get("/products", async (req, res) => {
  try {
    const products = await productCollection
      .find({ status: "active" })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(products);
  } catch (error) {
    res.status(500).send({ message: "Failed to load products" });
  }
});


// Get product by id
app.get("/products/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const product = await productCollection.findOne({ _id: new ObjectId(id) });
    if (!product) return res.status(404).send({ message: "Product not found" });
    res.send(product);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch product" });
  }
});




    app.get("/", (req, res) => res.send("🚀 Server running"));
  } catch (err) {
    console.error(err);
  }
}

run();

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
