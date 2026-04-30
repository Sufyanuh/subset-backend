import mongoose from "mongoose";
const Schema = mongoose.Schema;

const commentSchema = new Schema(
  {
    post: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    media: [
      {
        url: String,
        mediaType: {
          type: String,
          enum: ["image", "video"],
        },
      },
    ],
    author: {
      type: Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },
    authorName: String,
    authorAvatar: String,
    likes: [
      {
        user: {
          type: Schema.Types.ObjectId,
          ref: "user",
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    likeCount: {
      type: Number,
      default: 0,
    },
    parentComment: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    mentions: [{
      type: Schema.Types.ObjectId,
      ref: "user",
    }],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

// Update like count when likes change
commentSchema.pre("save", function (next) {
  if (this.isModified("likes")) {
    this.likeCount = this.likes.length;
  }
  next();
});

commentSchema.virtual("replies", {
  ref: "Comment", // The model to use
  localField: "_id", // Find comments where...
  foreignField: "parentComment", // ...parentComment matches this comment's _id
  justOne: false, // Get an array of replies
});

commentSchema.virtual("isLiked").get(function () {
  return function (userId) {
    return this.likes.some((like) => like.user.equals(userId));
  };
});

const Comment = mongoose.model("Comment", commentSchema);

export default Comment;
