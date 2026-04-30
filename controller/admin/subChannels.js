import { Channels } from "../../model/channels.js";
import { SubChannels } from "../../model/subChannels.js";

export const createSubChannel = async (req, res) => {
  try {
    const { name, channel, isPrivate, forAdmin } = req.body;

    if (!name || !channel) {
      return res
        .status(400)
        .json({ message: "Name and channel ID are required." });
    }

    const lastSubChannel = await SubChannels.findOne({ channel })
      .sort({ order: -1 })
      .select("order");

    const newOrder = lastSubChannel ? lastSubChannel.order + 1 : 0;

    const newSubChannel = await SubChannels.create({
      name,
      channel,
      order: newOrder,
      isPrivate: isPrivate ?? false,
      forAdmin: forAdmin ?? false,
    });

    res.status(201).json({
      message: "SubChannel created successfully",
      data: newSubChannel,
    });
  } catch (errors) {
    console.error(errors);

    // Handle duplicate name error within same channel
    if (errors.code === 11000) {
      return res.status(400).json({
        message: "SubChannel name already exists in this channel",
      });
    }

    res.status(500).json({
      message: errors.message || "Internal server error",
      errors,
    });
  }
};

export const getSubChannels = async (req, res) => {
  try {
    const subChannels = await SubChannels.find().populate("channel");
    res.status(200).json({ data: subChannels });
  } catch (errors) {
    console.error(errors);
    res.status(500).json({ message: errors.message, errors });
  }
};

export const getSubChannelById = async (req, res) => {
  try {
    const { id } = req.params;

    const subChannel = await SubChannels.findById(id).populate("channel");

    if (!subChannel) {
      return res.status(404).json({ message: "SubChannel not found" });
    }

    res.status(200).json({ data: subChannel });
  } catch (errors) {
    console.error(errors);
    res.status(500).json({ message: errors.message, errors });
  }
};
export const getSubChannelWithChannelId = async (req, res) => {
  try {
    const { channelId } = req.params;

    // Basic validation
    if (!channelId) {
      return res.status(400).json({
        message: "Channel ID is required",
      });
    }

    // Check if channel exists
    const channel = await Channels.findById(channelId);
    if (!channel) {
      return res.status(404).json({
        message: "Channel not found",
      });
    }

    // Get subchannels for this channel, sorted by order
    const subchannels = await SubChannels.find({
      channel: channelId,
    })
      .sort({ order: 1, createdAt: 1 })
      .populate("channel");

    res.status(200).json({
      success: true,
      message: "SubChannels fetched successfully",
      data: subchannels,
    });
  } catch (error) {
    console.error("Error in getSubChannelWithChannelId:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
      error: error,
    });
  }
};

export const deleteSubChannelById = async (req, res) => {
  try {
    const { id } = req.params;
    await SubChannels.findByIdAndDelete(id);
    res.status(200).json({
      message: "SubChannel Deleted Successfully",
    });
  } catch (errors) {
    console.error(errors);
    res.status(500).json({ message: errors.message, errors });
  }
};
// Update isPrivate
export const updateSubChannelPrivacy = async (req, res) => {
  try {
    const { id } = req.params;
    const { isPrivate } = req.body;

    if (typeof isPrivate !== "boolean") {
      return res.status(400).json({ message: "isPrivate must be a boolean." });
    }

    const updatedSubChannel = await SubChannels.findByIdAndUpdate(
      id,
      { isPrivate },
      { new: true }
    );

    if (!updatedSubChannel) {
      return res.status(404).json({ message: "SubChannel not found." });
    }

    res.status(200).json({
      message: "SubChannel privacy updated successfully",
      data: updatedSubChannel,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message, error });
  }
};

// Update forAdmin
export const updateSubChannelForAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { forAdmin } = req.body;

    if (typeof forAdmin !== "boolean") {
      return res.status(400).json({ message: "forAdmin must be a boolean." });
    }

    const updatedSubChannel = await SubChannels.findByIdAndUpdate(
      id,
      { forAdmin },
      { new: true }
    );

    if (!updatedSubChannel) {
      return res.status(404).json({ message: "SubChannel not found." });
    }

    res.status(200).json({
      message: "SubChannel admin status updated successfully",
      data: updatedSubChannel,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message, error });
  }
};
export const updateSubChannel = async (req, res) => {
  try {
    const { id } = req.params; // SubChannel ID from URL
    const { name, isPrivate, forAdmin } = req.body;

    if (!id) {
      return res.status(400).json({ message: "SubChannel ID is required." });
    }

    const subChannel = await SubChannels.findById(id);

    if (!subChannel) {
      return res.status(404).json({ message: "SubChannel not found." });
    }

    // 🟡 If updating name → Check duplicate in same channel
    if (name && name !== subChannel.name) {
      const alreadyExists = await SubChannels.findOne({
        name,
        channel: subChannel.channel,
      });

      if (alreadyExists) {
        return res.status(400).json({
          message:
            "Another sub channel with this name already exists in this channel.",
        });
      }
    }

    // ✅ Update fields
    subChannel.name = name ?? subChannel.name;
    subChannel.isPrivate = isPrivate ?? subChannel.isPrivate;
    subChannel.forAdmin = forAdmin ?? subChannel.forAdmin;

    const updatedSubChannel = await subChannel.save();

    return res.status(200).json({
      message: "SubChannel updated successfully ✅",
      data: updatedSubChannel,
    });
  } catch (error) {
    console.error("Update SubChannel Error:", error);
    res.status(500).json({ message: error.message || "Server error", error });
  }
};

export const rearrangeSubChannels = async (req, res) => {
  try {
    const { channelId } = req.params;
    const { newOrder } = req.body; // Array of subchannel IDs in new order

    if (!Array.isArray(newOrder)) {
      return res.status(400).json({
        message: "newOrder must be an array of subchannel IDs",
      });
    }

    for (let i = 0; i < newOrder.length; i++) {
      await SubChannels.findOneAndUpdate(
        {
          _id: newOrder[i],
          channel: channelId,
        },
        { order: i }
      );
    }

    res.status(200).json({
      message: "SubChannels rearranged successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: error.message,
    });
  }
};
