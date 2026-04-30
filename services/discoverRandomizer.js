import cron from "node-cron";
import { Discover } from "../model/discover.js";

export let lastDiscoverCronRun = null;
export let lastDiscoverCronEnd = null;

export const randomizeDiscoverIndexes = async () => {
  const discovers = await Discover.find({});
  const indexes = discovers.map((_, i) => i);
  for (let i = indexes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  for (let i = 0; i < discovers.length; i++) {
    discovers[i].index = indexes[i];
    await discovers[i].save();
  }
};
