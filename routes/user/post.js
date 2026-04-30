import { Router } from "express";
import {
  createPost,
  deletePost,
  getPostById,
  getPostsByChannelId,
  likeDislikePost,
  ReportPost,
  toggleCommenting,
  togglePinned,
  updatePost,
} from "../../controller/user/post.js";

export const postRoutes = Router();
postRoutes.post("/", createPost);
postRoutes.put("/updatebyId/:postId", updatePost);
postRoutes.get("/:channelId", getPostsByChannelId);
postRoutes.delete("/:postId", deletePost);
postRoutes.post("/likeDislike/:postId", likeDislikePost);
postRoutes.post("/togglePinned/:postId", togglePinned);
postRoutes.post("/toggleCommenting/:postId", toggleCommenting);
postRoutes.post("/report/:postId", ReportPost);
