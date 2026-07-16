const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);

    console.log(`✅ MongoDB verbunden: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error('❌ MongoDB Verbindungsfehler:', error.message);
    throw error;
  }
};

module.exports = connectDB;
