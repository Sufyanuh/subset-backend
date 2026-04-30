import { User } from "../model/user.js";

export const generateUsername = async (email) => {
  const base = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
  let username = base;
  let exists = await User.findOne({ username });
  let counter = 1;

  while (exists) {
    username = `${base}${counter}`;
    exists = await User.findOne({ username });
    counter++;
  }

  return username;
};
