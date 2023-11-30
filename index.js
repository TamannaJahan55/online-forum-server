const express = require('express');
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.7fnf5wg.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const postCollection = client.db("forumDb").collection("post");
    const userCollection = client.db("forumDb").collection("users");
    const announcementCollection = client.db("forumDb").collection("announcements");

    // middlewares
    const verifyToken = (req, res, next) => {
      console.log('inside verify token', req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: 'unauthorized access' });
      }
      const token = req.headers.authorization.split(' ')[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: 'unauthorized access' })
        }
        req.decoded = decoded;
        next();
      })
    }

    // jwt related api
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET);
      res.send({ token });
    })

    // use verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next();
    }


    // users related api
    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
      console.log(req.headers)
      const result = await userCollection.find().toArray();
      res.send(result);
    })

    app.get('/users/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: email }
      const result = await userCollection.findOne(query);
      res.send(result);
    })

    app.get('/users/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'forbidden access' })
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === 'admin';
      }
      res.send({ admin });
    })

    app.post('/users', async (req, res) => {
      const user = req.body;
      const query = { email: user.email }
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: 'user already exists', insertedId: null })
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    })

    app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    })


    // posts related apis
    app.get('/post', async (req, res) => {
      const result = await postCollection.find().toArray();
      res.send(result);
    })

    app.get('/post/post_time/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: email }
      const result = await postCollection.find(query).toArray();
      res.send(result);
    })

    app.get('/post/post_time/tag/:tag', async (req, res) => {
      const tag = req.params.tag;
      console.log(tag);
      const query = { tag: "#" + tag }
      console.log(query);
      const result = await postCollection.find(query).toArray();
      res.send(result);
    })

    app.get('/post/post_time/id/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await postCollection.findOne(query);
      res.send(result);
    })

    app.get('/post/post_time', async (req, res) => {
      const filter = req.query;
      const query = {};
      const options = {
        sort: {
          post_time: filter.sort === 'desc' ? 1 : -1,
        }
      }
      const page = parseInt(req.query.page);
      const size = parseInt(req.query.size);
      console.log('pagination query', page, size)
      const cursor = postCollection.find(query, options).skip(page * size).limit(size);
      const result = await cursor.toArray();
      res.send(result);
    })

    app.get('/postCount', async (req, res) => {
      const count = await postCollection.estimatedDocumentCount();
      res.send({ count });
    })

    app.post('/post', async (req, res) => {
      const item = req.body;
      const result = await postCollection.insertOne(item);
      res.send(result);
    })

    app.delete('/post/post_time/:email/:id', verifyToken, async (req, res) => {
      const email = req.params.email;
      const id = req.params.id;
      const result = await postCollection.deleteOne({ email: email, _id: new ObjectId(id) });
      res.send(result);
    })

    // announcement
    app.get('/announcement', async (req, res) => {
      const result = await announcementCollection.find().toArray();
      res.send(result);
    })

    app.post('/announcement', async (req, res) => {
      const item = req.body;
      const result = await announcementCollection.insertOne(item);
      res.send(result);
    })

    // payment intent
    app.post('/create-payment-intent', async (req, res) => {
      const { subscription_fee } = req.body;
      const amount = parseInt(subscription_fee * 100);
      console.log(amount, 'amount inside the intent');

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
      });

      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })

    app.get('/payments/:email', async (req, res) => {
      const query = { email: req.params.email }
      if (req.params.email !== req.decoded.email) {
        return res.status(403).send({ message: 'forbidden access' })
      }
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    })



    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('forum is running')
})

app.listen(port, () => {
  console.log(`Online forum is running on port ${port}`)
})