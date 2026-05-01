import { Discover } from "../../model/discover.js";

export const filterDiscoveries = async (req, res) => {
  try {
    const { category, search, type } = req.query;

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Math.min(Number.isNaN(limitRaw) ? 20 : limitRaw, 100);
    const skip = (page - 1) * limit;

    const matchStage = {};

    if (category) {
      matchStage.categories = category;
    }

    if (type) {
      matchStage.type = type;
    }

    if (search) {
      matchStage.$or = [
        { title: { $regex: search, $options: "i" } },
        { tags: { $regex: search, $options: "i" } },
      ];
    }

    const [discoveries, total] = await Promise.all([
      Discover.aggregate([
        { $match: matchStage },

        // 👇 date only (ignore time)
        {
          $addFields: {
            sortDate: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$uploadAt",
              },
            },
          },
        },

        {
          $lookup: {
            from: "categories",
            localField: "categories",
            foreignField: "_id",
            as: "categories",
          },
        },

        {
          $sort: {
            sortDate: -1, // 👈 date first
            index: 1, // 👈 then index
          },
        },

        {
          $project: {
            sortDate: 0, // 👈 hide field
          },
        },

        { $skip: skip },
        { $limit: limit },
      ]),

      Discover.countDocuments(matchStage),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;
    const hasNextPage = page < totalPages;

    res.status(200).json({
      data: discoveries,
      page,
      limit,
      total,
      totalPages,
      hasNextPage,
    });
  } catch (error) {
    console.error("Error filtering discoveries:", error);
    res.status(500).json({ message: "Something went wrong", error });
  }
};
