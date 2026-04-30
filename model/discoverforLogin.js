import { Schema, model } from "mongoose";

const discoverforLoginSchema = new Schema({
    discoverId: { type: Schema.Types.ObjectId, ref: "discover" },
}, { timestamps: true });

export const DiscoverforLogin = model("discoverforLogin", discoverforLoginSchema);