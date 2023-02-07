const { MongoClient, ServerApiVersion } = require('mongodb');
const express = require('express');
const app = express();
const cors = require('cors');
const port = process.env.PORT || 5000;
require('dotenv').config();
app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASS}@cluster0.uypmgup.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function run() {
  try {
    const doctorsService = client.db("doctorsPortal").collection("services");
    const bookingService = client.db("doctorsPortal").collection("bookings");

    app.get('/service', async (req, res) => {
      const query = {}
      const cursor = doctorsService.find(query);
      const services = await cursor.toArray()
      res.send(services);
    })

    // add a booking 
    app.post('/booking', async(req,res)=>{
      const booking = req.body;
      const query = {treatment: booking.treatment, date: booking.date, patient: booking.patient};
      const exists = await bookingService.findOne(query);
      
      if(exists){
        return res.send({success: false, booking:exists})
      }
      const result = await bookingService.insertOne(booking);
      return res.send({success:true, result});
    })

    // find available slots 

    app.get('/availble', async(req, res)=>{
      const date = req.query.date;
      const query = {};
      //  step1. get all services 
      const services = await doctorsService.find(query).toArray();

      //  step2. get booking of the day
      const bookingQuery = {date: date}
      const bookings = await bookingService.find(bookingQuery).toArray();
      
      // stp 3: for each service , find bookings for that service 


      services.forEach(service=>{
        // step 4: find bookings for that service. output: [{}, {}, {}, {}]
        const serviceBookings = bookings.filter(book => book.treatment === service.name);
        // step 5: select slots for the service Bookings: ['', '', '', '']
        const bookedSlots = serviceBookings.map(book=>book.slot);
        // step 6: select those slots that are not in bookedSlots
        const available = service.slots.filter(slot => !bookedSlots.includes(slot));
        //step 7: set available to slots to make it easiergit 
        service.slots = available;
      })

      

      res.send(services);
    })

  }

  finally {

  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Doctors World!')
})

app.listen(port, () => {
  console.log(` Doctors App is listening to ${port}`)
})