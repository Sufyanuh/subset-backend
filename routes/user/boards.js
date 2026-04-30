import { Router } from "express";
export const userBoardsRouter = Router();

import {
  CreateBoard,
  getUsersBoards,
  deleteBoard,
  updateBoard,
  PrivateBoard,
  getBoardById,
} from "../../controller/user/boards.js";
import { checkAuthToken } from "../../middleware/checkToken.js";

userBoardsRouter
  .route("/")
  .post(checkAuthToken, CreateBoard)
  .get(checkAuthToken, getUsersBoards);
userBoardsRouter
  .route("/:id")
  .delete(checkAuthToken, deleteBoard)
  .put(checkAuthToken, updateBoard)
  .get(getBoardById);

userBoardsRouter.post("/updatePrivate/:id", checkAuthToken, PrivateBoard);
