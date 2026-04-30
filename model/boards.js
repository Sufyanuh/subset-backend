import { Schema, model } from "mongoose";
const boardsSchema = Schema({
  userId: { required: true, ref: "user", type: Schema.Types.ObjectId },
  name: {
    type: String,
    required: true,
  },
  isPrivate: { default: false, enum: [true, false], type: Boolean },
  discover: {
    type: [Schema.Types.ObjectId],
    ref: "discover",
  },
});
export const Boards = model("boards", boardsSchema);
