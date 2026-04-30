import { Router } from "express";
import {
  createComment,
  deleteComment,
  editComment,
  getPostComments,
  likeDislikeComment,
  ReportComment,
} from "../../controller/user/comment.js";

export const commentRoutes = Router();
commentRoutes.post("/", createComment);
commentRoutes.put("/editComment", editComment);
commentRoutes.get("/:postId", getPostComments);
commentRoutes.delete("/:commentId", deleteComment);
commentRoutes.post("/likeDislike/:commentId", likeDislikeComment);
commentRoutes.post("/reportcomment/:commentId", ReportComment);
