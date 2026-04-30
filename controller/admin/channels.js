import { Channels } from "../../model/channels.js";
import { SubChannels } from "../../model/subChannels.js";

export const AddChannel = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({
        message: "Channel name is required",
      });
    }

    // Find the last order number for channels
    const lastChannel = await Channels.findOne()
      .sort({ order: -1 }) // Get the highest order
      .select("order");

    const newOrder = lastChannel ? lastChannel.order + 1 : 0;

    const newChannel = await Channels.create({
      name,
      order: newOrder,
    });

    res.status(201).json({
      message: "Channel Created Successfully",
      data: newChannel,
    });
  } catch (errors) {
    console.error(errors);

    // Handle duplicate name error
    if (errors.code === 11000) {
      return res.status(400).json({
        message: "Channel name already exists",
      });
    }

    res.status(500).json({
      message: errors.message || "Internal server error",
      errors,
    });
  }
};
export const getChannels = async (req, res) => {
  try {
    const channels = await Channels.find({}).sort({ order: 1, createdAt: 1 });
    res
      .status(200)
      .json({ message: "Channels Found SuccessFully", data: channels });
  } catch (errors) {
    console.error(errors);
    res.status(500).json({ message: errors.message, errors });
  }
};

export const getChannel = async (req, res) => {
  try {
    const { id } = req.params;
    const channel = await Channels.findById(id);
    res
      .status(200)
      .json({ message: "Channel Found SuccessFully", data: channel });
  } catch (errors) {
    console.error(errors);
    res.status(500).json({ message: errors.message, errors });
  }
};

export const UpdateChannel = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const channel = await Channels.findByIdAndUpdate(
      id,
      { name },
      { new: true }
    );
    res
      .status(200)
      .json({ message: "Channel Updated SuccessFully", data: channel });
  } catch (errors) {
    console.error(errors);
    res.status(500).json({ message: errors.message, errors });
  }
};
export const DeleteChannel = async (req, res) => {
  try {
    const { id } = req.params;
    const channel = await Channels.findByIdAndDelete(id);
    res
      .status(200)
      .json({ message: "Channel Deleted SuccessFully", data: channel });
  } catch (errors) {
    console.error(errors);
    res.status(500).json({ message: errors.message, errors });
  }
};

export const getChannelsWithSubChannel = async (req, res) => {
  try {
    const channels = await Channels.find().sort({
      order: 1,
      createdAt: 1,
    });
    const subchannels = await SubChannels.find().populate("channel").sort({
      order: 1,
      createdAt: 1,
    });

    const subchannelMap = {};
    subchannels.forEach((sub) => {
      const channelId = sub.channel._id.toString();
      if (!subchannelMap[channelId]) subchannelMap[channelId] = [];
      subchannelMap[channelId].push(sub);
    });

    const result = channels.map((channel) => ({
      ...channel.toObject(),
      subchannels: subchannelMap[channel._id.toString()] || [],
    }));

    res.status(200).json({ success: true, data: result });
  } catch (errors) {
    console.error(errors);
    res.status(500).json({ errors, message: errors.message });
  }
};

export const rearrangeChannels = async (req, res) => {
  try {
    const { newOrder } = req.body;

    if (!Array.isArray(newOrder)) {
      return res.status(400).json({
        message: "newOrder must be an array of channel IDs",
      });
    }

    // Simple: Update each channel with its new order
    for (let i = 0; i < newOrder.length; i++) {
      await Channels.findByIdAndUpdate(newOrder[i], { order: i });
    }

    res.status(200).json({
      message: "Channels rearranged successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: error.message,
    });
  }
};
