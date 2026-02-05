

const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");

const app = express();
const port = process.env.PORT || 5000;

// 🔹 Firebase Admin সেটআপ
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  })
});

// Middleware
app.use(cors());
app.use(express.json());

// 🔹 Firebase token verify middleware
const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;

    if (!token) return res.status(401).send({ message: 'Unauthorized access' });

    try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        req.decoded_email = decoded.email;
        next();
    } catch (err) {
        return res.status(401).send({ message: 'Unauthorized access' });
    }
};

// 🔹 MongoDB সংযোগ
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fu1n5ti.mongodb.net/garmentOpsDB?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db('garmentDB');
    const userCollection = db.collection('user');

    const verifyAdmin = async (req, res, next)=>{
        const email= req.decoded_email
        const query ={email}
        const user =await userCollection.findOne(query)

        if (!user || user.role !== 'admin'){
            return res.status(403).send({message: 'forbidden access'})
        }

        next()
    }

    console.log("✅ MongoDB connected successfully");

    // 🔹 POST /users → user data insert
    app.post('/user', async (req, res) => {
  const userData = req.body;

  if (!userData.email) {
    return res.status(400).send({ message: 'Email is required' });
  }

  try {
    const existingUser = await userCollection.findOne({
      email: userData.email
    });

    // ✅ User থাকলে শুধু success response
    if (existingUser) {
      return res.send({
        message: "User already exists",
        inserted: false
      });
    }

    // ✅ User না থাকলে insert
    const result = await userCollection.insertOne(userData);

    res.send({
      message: "User inserted successfully",
      inserted: true,
      userId: result.insertedId
    });

  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Server error" });
  }
});

// /Get All Users
app.get("/user",verifyFBToken, async (req, res) => {
  const users = await userCollection.find().toArray();
  res.send(users);
});


//Update Role//
app.patch("/user/role/:id",verifyFBToken, async (req, res) => {
  const id = req.params.id;
  const role = req.body.role;

  const result = await userCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { role } }
  );
  res.send(result);
});

//Update Status
app.patch("/user/status/:id",verifyFBToken, async (req, res) => {
  const id = req.params.id;
  const status = req.body.status;

  const result = await userCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status } }
  );

  res.send(result);
});

// GET /user/:email/role → return role as JSON
    app.get('/user/:email/role', verifyFBToken, async (req,res)=>{
      const email = req.params.email;
      const user = await userCollection.findOne({ email });
      res.send({
  role: user?.role || 'user',
  status: user?.status || 'pending'
});
    });



  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  }
}

run();

app.get('/', (req, res) => res.send('Server is running'));

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
