const { MongoClient, ServerApiVersion, ObjectId } = require( 'mongodb' );
const express = require( 'express' );
const jwt = require( 'jsonwebtoken' );
const cors = require( 'cors' );
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


const app = express();
const port = process.env.PORT || 5000;

require( 'dotenv' ).config();
app.use( cors() );
app.use( express.json() );



const uri = `mongodb+srv://${ process.env.DB_NAME }:${ process.env.DB_PASS }@cluster0.uypmgup.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient( uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 } );


function verifyJWT ( req, res, next )
{
  // header read 
  const authHeader = req.headers.authorization;
  if ( !authHeader )
  {
    return res.status( 401 ).send( { message: 'UnAthorized access' } );
  }
  const token = authHeader.split( ' ' )[ 1 ];
  jwt.verify( token, process.env.ACCESS_TOKEN_SECRET, function ( err, decoded )
  {
    if ( err )
    {
      return res.status( 403 ).send( { message: 'Forbidden access' } )
    }
    req.decoded = decoded;
    next();
  } );
}

async function run ()
{
  try
  {
    const doctorsService = client.db( "doctorsPortal" ).collection( "services" );
    const bookingCollections = client.db( "doctorsPortal" ).collection( "bookings" );
    const userCollections = client.db( "doctorsPortal" ).collection( "users" );
    const doctorsCollection = client.db( "doctorsPortal" ).collection( "doctors" );
    const paymentCollection = client.db( "doctorsPortal" ).collection( "payments" );

    const verifyAdmin = async ( req, res, next ) =>
    {
      const requester = req.decoded.email;
      const requesterAcccount = await userCollections.findOne( { email: requester } )
      if ( requesterAcccount.role === 'admin' )
      {
        next()
      }
      else
      {
        res.status( 403 ).send( { message: 'forbidden' } );
      }
    }


    // payment methods 

    app.post('/create-payment-intent', verifyJWT, async(req, res) =>{
      const service = req.body;
      const price = service.price;
      const amount = price*100;
      const paymentIntent = await stripe.PaymentIntents.create({
        amount : amount,
        currency: 'usd',
        payment_method_types:['card']
      });
      console.log(paymentIntent);
      res.send({clientSecret: paymentIntent.client_secret});
      
    });

    app.get( '/service', async ( req, res ) =>
    {
      const query = {}
      const cursor = doctorsService.find( query ).project( { name: 1 } );
      const services = await cursor.toArray()
      res.send( services );
    } )
    // load all users on admin page
    app.get( '/user', verifyJWT, async ( req, res ) =>
    {
      const users = await userCollections.find().toArray();
      res.send( users )
    } )

    // user creation process 

    app.put( '/user/:email', async ( req, res ) =>
    {
      const email = req.params.email;
      const filter = { email: email };
      const options = { upsert: true };
      const user = req.body;
      const updateDoc = {
        $set: user
      };
      const token = jwt.sign( { email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' } );
      const result = await userCollections.updateOne( filter, updateDoc, options );
      res.send( { result, token } );

    } )
    // make an admin
    app.put( '/user/admin/:email', verifyJWT, verifyAdmin, async ( req, res ) =>
    {
      const email = req.params.email;
      const filter = { email: email };
      const updateDoc = {
        $set: { role: 'admin' },
      };
      const result = await userCollections.updateOne( filter, updateDoc );
      res.send( { result } );
    } )

    app.get( '/admin/:email', async ( req, res ) =>
    {
      const email = req.params.email;
      const user = await userCollections.findOne( { email: email } );
      const isAdmin = user.role === 'admin';
      res.send( { admin: isAdmin } );
    } )



    app.get( '/booking', verifyJWT, async ( req, res ) =>
    {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if ( patient === decodedEmail )
      {
        const query = { patient: patient }
        const bookings = await bookingCollections.find( query ).toArray();
        return res.send( bookings );
      }
      else
      {
        return res.status( 403 ).send( { message: 'Forbidden access' } );
      }
    } )

    app.get('/booking/:id', verifyJWT, async(req,res)=>{
      const id = req.params.id;
      const query = {_id:ObjectId(id)};
      const booking = await bookingCollections.findOne(query);
      res.send(booking);
    })

    // add a booking 
    app.post( '/booking', async ( req, res ) =>
    {
      const booking = req.body;
      const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient };
      const exists = await bookingCollections.findOne( query );

      if ( exists )
      {
        return res.send( { success: false, booking: exists } )
      }
      const result = await bookingCollections.insertOne( booking );
      return res.send( { success: true, result } );
    } )

    app.patch('/booking/:id', verifyJWT, async(req, res)=>{
      const id = req.params.id;
      const payment = req.body;
      const filter = {_id: ObjectId(id)};
      const updatedDoc = {
        $set:{
          paid : true,
          transactionId: payment.transactionId
        }
      }
      const updateDbooking = await bookingCollections.updateOne(filter, updatedDoc);
      const result = await paymentCollection.insertOne(payment);
      res.send(updatedDoc);
    })

    // find available slots 

    app.get( '/availble', async ( req, res ) =>
    {
      const date = req.query.date;
      const query = {};
      //  step1. get all services 
      const services = await doctorsService.find( query ).toArray();

      //  step2. get booking of the day
      const bookingQuery = { date: date }
      const bookings = await bookingCollections.find( bookingQuery ).toArray();

      // stp 3: for each service , find bookings for that service 


      services.forEach( service =>
      {
        // step 4: find bookings for that service. output: [{}, {}, {}, {}]
        const serviceBookings = bookings.filter( book => book.treatment === service.name );
        // step 5: select slots for the service Bookings: ['', '', '', '']
        const bookedSlots = serviceBookings.map( book => book.slot );
        // step 6: select those slots that are not in bookedSlots
        const available = service.slots.filter( slot => !bookedSlots.includes( slot ) );
        //step 7: set available to slots to make it easier
        service.slots = available;
      } )
      res.send( services );
    } );

    app.get('/doctor', verifyJWT, verifyAdmin, async(req,res)=>{
      const doctors = await doctorsCollection.find().toArray();
      res.send(doctors);
    })
    //  make a doctor 
    app.post( '/doctor', verifyJWT, verifyAdmin, async ( req, res ) =>
    {
      const doctor = req.body;
      const result = await doctorsCollection.insertOne( doctor );
      res.send( result );
    } )
    app.delete( '/doctor/:email', verifyJWT, verifyAdmin, async ( req, res ) =>
    {
      const email  = req.params.email;
      const filter = {email: email}
      const result = await doctorsCollection.deleteOne(filter);
      res.send( result );
    } )

  }

  finally
  {

  }
}
run().catch( console.dir );


app.get( '/', ( req, res ) =>
{
  res.send( 'Doctors World!' )
} )

app.listen( port, () =>
{
  console.log( ` Doctors App is listening to ${ port }` )
} )