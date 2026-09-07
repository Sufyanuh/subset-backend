import { connect, set } from "mongoose";
export const ConnectMongoDB = async () => {
  try {
    await connect(process.env.MONGO_URI),
      set("debug", true);

    console.log("Connected to MongoDB successfully!");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error.message || error);
  }
};
