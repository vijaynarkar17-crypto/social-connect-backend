import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set in backend/.env');

  // Log every query during development to spot slow/unindexed operations.
  if (process.env.NODE_ENV !== 'production' && process.env.MONGO_DEBUG === 'true') {
    mongoose.set('debug', true);
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });
  console.log('✓ Connected to MongoDB');
}
