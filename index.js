

// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);


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

let userCollection, productCollection, bookingCollection;

async function run() {
  try {
    await client.connect();
    const db = client.db("garmentDB");
    userCollection = db.collection("user");
    productCollection = db.collection("products");
    bookingCollection = db.collection("bookings");

    console.log("✅ MongoDB connected");

    // ---------------- Firebase Token Verify ----------------
    const verifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).send({ message: "Unauthorized" });

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
      if (!user || user.role !== "admin") return res.status(403).send({ message: "Forbidden" });
      next();
    };

    // ---------------- Verify Manager ----------------
    const verifyManager = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await userCollection.findOne({ email });
      if (!user) return res.status(401).send({ message: "Unauthorized" });
      if (user.role !== "manager" || user.status !== "approved")
        return res.status(403).send({ message: "Forbidden" });
      next();
    };

    // =====================================================
    // 👤 USERS API
    // =====================================================
    app.post("/user", async (req, res) => {
      const userData = req.body;
      if (!userData.email) return res.status(400).send({ message: "Email required" });

      const existingUser = await userCollection.findOne({ email: userData.email });
      if (existingUser) return res.send({ inserted: false, message: "User exists" });

      const result = await userCollection.insertOne({
        ...userData,
        role: "buyer",
        status: "pending",
        createdAt: new Date(),
      });

      res.send({ inserted: true, userId: result.insertedId });
    });

    app.get("/user", verifyFBToken, verifyAdmin, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    app.get("/user/:email/role", verifyFBToken, async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });
      res.send({ role: user?.role || "buyer", status: user?.status || "pending" });
    });

    app.patch("/user/role/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;
      const result = await userCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      );
      res.send(result);
    });

    app.patch("/user/status/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const result = await userCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );
      res.send(result);
    });

    // =====================================================
    // 📦 PRODUCTS API
    // =====================================================
    app.post("/products", verifyFBToken, verifyManager, async (req, res) => {
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
      )
        return res.status(400).send({ message: "Missing fields" });

      const newProduct = {
        ...product,
        createdBy: req.decoded_email,
        status: "active",
        createdAt: new Date(),
      };

      const result = await productCollection.insertOne(newProduct);
      res.send({ success: true, insertedId: result.insertedId });
    });

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

    app.get("/products", async (req, res) => {
      try {
        const products = await productCollection.find({ status: "active" }).sort({ createdAt: -1 }).toArray();
        res.send(products);
      } catch (error) {
        res.status(500).send({ message: "Failed to load products" });
      }
    });

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

    // =====================================================
    // 📄 BOOKINGS API
    // =====================================================

    // Create new booking
    app.post("/bookings", async (req, res) => {
      try {
        const bookingData = req.body;

        if (
          !bookingData.productId ||
          !bookingData.productTitle ||
          !bookingData.email ||
          !bookingData.firstName ||
          !bookingData.lastName ||
          !bookingData.quantity ||
          !bookingData.orderPrice ||
          !bookingData.contactNumber ||
          !bookingData.deliveryAddress ||
          !bookingData.paymentMethod
        ) return res.status(400).send({ message: "Missing booking fields" });

        const result = await bookingCollection.insertOne({
          ...bookingData,
          createdAt: new Date(),
        });

        res.status(201).send({ success: true, _id: result.insertedId });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to create booking", error: error.message });
      }
    });

// GET My Orders
app.get("/bookings", verifyFBToken, async (req, res) => {
  const email = req.query.email;

  // 🔒 Security check
  if (email !== req.decoded_email) {
    return res.status(403).send({ message: "Forbidden access" });
  }

  const bookings = await bookingCollection
    .find({ email })
    .sort({ createdAt: -1 })
    .toArray();

  res.send(bookings);
});


// Cancel booking (pending or awaiting-payment):
app.patch("/bookings/cancel/:id", verifyFBToken, async (req, res) => {
  const id = req.params.id;

  const booking = await bookingCollection.findOne({
    _id: new ObjectId(id),
  });

  if (!booking)
    return res.status(404).send({ message: "Booking not found" });

  // 🔒 owner check
  if (booking.email !== req.decoded_email) {
    return res.status(403).send({ message: "Forbidden access" });
  }

  // ✅ Allow cancel for pending or awaiting-payment
  if (booking.status !== "pending" && booking.status !== "awaiting-payment") {
    return res.status(400).send({ message: "Cannot cancel this order" });
  }

  const result = await bookingCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status: "canceled" } }
  );

  res.send({ success: true, message: "Order canceled", result });
});



    // Get booking by ID (for payment page)
app.get("/bookings/:id", verifyFBToken, async (req, res) => {
  const booking = await bookingCollection.findOne({
    _id: new ObjectId(req.params.id),
  });

  if (!booking) return res.status(404).send({ message: "Booking not found" });

  // 🔒 owner check
  if (booking.email !== req.decoded_email) {
    return res.status(403).send({ message: "Forbidden access" });
  }

  res.send(booking);
});



//  Create Payment Api
app.post("/create-payment-intent", verifyFBToken, async (req, res) => {
  const { amount } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).send({ message: "Invalid amount" });
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: "usd",
    payment_method_types: ["card"],
  });

  res.send({ clientSecret: paymentIntent.client_secret });
});



// Update booking after payment success
app.patch("/bookings/payment-success/:id", verifyFBToken, async (req, res) => {
  const id = req.params.id;

  const booking = await bookingCollection.findOne({ _id: new ObjectId(id) });

  if (!booking) return res.status(404).send({ message: "Booking not found" });
  if (booking.email !== req.decoded_email)
    return res.status(403).send({ message: "Forbidden" });

  const result = await bookingCollection.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        status: "completed",
        paid: true,
        paidAt: new Date(),
      },
    }
  );

  res.send(result);
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
