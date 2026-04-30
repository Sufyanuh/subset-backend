import { Router } from "express";
import { AddtoBoard, RemoveFromBoard } from "../../controller/user/savetoboard.js";

export const savedBoardsRoutes = Router();
savedBoardsRoutes.post("/", AddtoBoard);
savedBoardsRoutes.post("/remove", RemoveFromBoard);
