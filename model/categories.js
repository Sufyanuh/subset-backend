import { Schema, model } from "mongoose";

const categoriesSchema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  position: {
    type: Number,
    default: 0, 
  },
});
export const Categories = model("categories", categoriesSchema);
