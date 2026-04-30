import { Discover } from "../model/discover.js";

export const getDiscoversByDateSafe = async (
  date,
  sortByIndex = false,
  populateCategories = false,
) => {
  const pipeline = [
    {
      $addFields: {
        dateOnly: {
          $dateToString: { format: "%Y-%m-%d", date: "$uploadAt" },
        },
      },
    },
    {
      $match: {
        dateOnly: date,
      },
    },
  ];

  if (sortByIndex) {
    pipeline.push({ $sort: { index: 1 } });
  }

  if (populateCategories) {
    pipeline.push({
      $lookup: {
        from: "categories",
        localField: "categories",
        foreignField: "_id",
        as: "categories",
      },
    });
  }

  pipeline.push({
    $project: {
      dateOnly: 0,
    },
  });

  return await Discover.aggregate(pipeline);
};
