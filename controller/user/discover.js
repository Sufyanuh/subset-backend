import { Discover } from "../../model/discover.js";

export const filterDiscoveries = async (req, res) => {
  try {
    const { category, search, type } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Math.min(Number.isNaN(limitRaw) ? 20 : limitRaw, 100);
    const skip = (page - 1) * limit;

    const query = {};
    if (category) {
      query.categories = category;
    }
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { tags: { $regex: search, $options: "i" } },
      ];
    }
    if (type) {
      query.type = type;
    }
    const [discoveries, total] = await Promise.all([
      Discover.find(query)
        .populate("categories")
        .sort({ uploadAt: -1, index: 1 })
        .skip(skip)
        .limit(limit),
      Discover.countDocuments(query),
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
    res.status(500).json({ message: "Something went wrong", error: error });
  }
};
