import { connect, set } from "mongoose";
export const ConnectMongoDB = async () => {
  try {
    await connect(process.env.MONGO_URI),
      set("debug", true);

    console.log("Connected to MongoDB successfully!", process.env.MONGO_URI);
  } catch (error) {
    console.error("Error connecting to MongoDB:", error, process.env.MONGO_URI);
  }
};
