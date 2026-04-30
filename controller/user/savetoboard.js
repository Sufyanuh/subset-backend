import mongoose from "mongoose";
import { Boards } from "../../model/boards.js";

export const AddtoBoard = async (req, res) => {
  const { boardId, discover } = req.body;
  const { _id: userId } = req.user;

  try {
    const board = await Boards.findOne({ userId, _id: boardId });

    if (!board) {
      return res.status(404).json({ message: "Board not found" });
    }
    // the free plan has a limit of 13 saves per board
    if (!req.user.isPaid && board.discover.length >= 13) {
      return res
        .status(403)
        .json({
          message:
            "Upgrade to a paid plan to save more discoveries on this board.",
        });
    }

    if (board.discover.includes(discover)) {
      return res
        .status(400)
        .json({ message: "Discover already exists in board" });
    } else {
      board.discover.push(discover);
      await board.save();
    }

    return res
      .status(200)
      .json({ message: "Added to board successfully", board });
  } catch (errors) {
    console.error(errors);
    return res.status(500).json({ message: errors.message, errors });
  }
};

export const RemoveFromBoard = async (req, res) => {
  const { boardId, discover } = req.body;
  const { _id: userId } = req.user;

  try {
    const board = await Boards.findOne({ userId, _id: boardId });

    if (!board) {
      return res.status(404).json({ message: "Board not found" });
    }

    // Convert discover to ObjectId for comparison
    const discoverId = new mongoose.Types.ObjectId(discover);

    // Check if the discover item exists
    const exists = board.discover.some(
      (item) => item.toString() === discoverId.toString()
    );

    if (!exists) {
      return res.status(400).json({ message: "Discover not found in board" });
    }

    // Remove it
    board.discover = board.discover.filter(
      (item) => item.toString() !== discoverId.toString()
    );

    await board.save();

    return res
      .status(200)
      .json({ message: "Removed from board successfully", board });
  } catch (errors) {
    console.error(errors);
    return res.status(500).json({ message: errors.message, errors });
  }
};
