import { Boards } from "../../model/boards.js";
import { User } from "../../model/user.js";

export const CreateBoard = async (req, res) => {
  try {
    const { name } = req.body;
    const { _id: userId } = req.user;

    // Check if a board with the same name already exists for this user
    const existingBoard = await Boards.findOne({ userId, name });

    const userBoardsCount = await Boards.countDocuments({ userId });
    const user = await User.findById(userId);

    if (!user.isPaid && userBoardsCount >= 2) {
      return res
        .status(403)
        .json({ message: "Upgrade to a paid plan to create more boards." });
    }
    if (existingBoard) {
      return res.status(400).json({ message: "Board already exists" });
    }

    // Create a new board
    const newBoard = new Boards({
      userId,
      name,
    });

    await newBoard.save();

    return res
      .status(201)
      .json({ message: "Board created successfully", board: newBoard });
  } catch (errors) {
    console.error("Error creating board:", errors);
    return res.status(500).json({ message: errors.message, errors });
  }
};
export const getBoardById = async (req, res) => {
  try {
    const { id } = req.params;
    const board = await Boards.findById(id).populate("discover");
    if (!board) {
      return res.status(404).json({ message: "Board not found" });
    }

    return res.status(201).json({ board: board });
  } catch (errors) {
    console.error("Error creating board:", errors);
    return res.status(500).json({ message: errors.message, errors });
  }
};
export const getUsersBoards = async (req, res) => {
  try {
    const { _id: userId } = req.user;
    const boards = await Boards.find({ userId }).populate("discover");

    return res
      .status(200)
      .json({ message: "Board Found successfully", data: boards });
  } catch (errors) {
    console.error("Error creating board:", errors);
    return res.status(500).json({ message: errors.message, errors });
  }
};
export const getUsersBoardsByusername = async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const boards = await Boards.find({ userId: user._id }).populate("discover");

    return res
      .status(200)
      .json({ message: "Board Found successfully", data: boards });
  } catch (errors) {
    console.error("Error creating board:", errors);
    return res.status(500).json({ message: errors.message, errors });
  }
};
export const deleteBoard = async (req, res) => {
  try {
    const { id } = req.params;
    const { _id: userId } = req.user;

    // Check if the board exists and belongs to the user
    const board = await Boards.findOneAndDelete({ _id: id, userId });

    if (!board) {
      return res.status(404).json({ message: "Board not found" });
    }

    return res.status(200).json({ message: "Board deleted successfully" });
  } catch (errors) {
    console.error("Error deleting board:", errors);
    return res.status(500).json({ message: errors.message, errors });
  }
};
export const updateBoard = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const { _id: userId } = req.user;

    const board = await Boards.findOneAndUpdate(
      { _id: id, userId },
      { name },
      { new: true } // Return the updated board
    );

    if (!board) {
      return res.status(404).json({ message: "Board not found" });
    }

    return res
      .status(200)
      .json({ message: "Board updated successfully", board });
  } catch (errors) {
    console.error("Error updating board:", errors);
    return res.status(500).json({ message: errors.message, errors });
  }
};
export const PrivateBoard = async (req, res) => {
  try {
    const { id } = req.params;

    const board = await Boards.findOne({
      _id: id,
    });
    if (!board) {
      return res.status(404).json({ message: "Board not found" });
    }
    board.isPrivate = !board.isPrivate;
    await board.save();
    return res
      .status(200)
      .json({ message: "Board updated successfully", board });
  } catch (errors) {
    console.error("Error updating board:", errors);
    return res.status(500).json({ message: errors.message, errors });
  }
};
