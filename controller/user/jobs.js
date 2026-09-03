import { Job } from "../../model/job.js";
import { User } from "../../model/user.js";

export const toggleSavedJobs = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user._id;

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    const isAlreadySaved = job.savedByUsers?.some(
      (id) => (id?._id || id)?.toString() === userId.toString(),
    );

    if (isAlreadySaved) {
      await Job.findByIdAndUpdate(jobId, { $pull: { savedByUsers: userId } });
      await User.findByIdAndUpdate(userId, { $pull: { savedJobs: jobId } });
      return res.status(200).json({ message: "Job removed from saved" });
    }

    await Job.findByIdAndUpdate(jobId, { $addToSet: { savedByUsers: userId } });
    await User.findByIdAndUpdate(userId, { $addToSet: { savedJobs: jobId } });
    return res.status(200).json({ message: "Job saved successfully" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const toggleConnection = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user._id;

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    if (!job.allowInternalConnections) {
      return res.status(400).json({
        message: "Internal connections are not enabled for this job post",
      });
    }

    const isConnected = job.connections?.some(
      (id) => (id?._id || id)?.toString() === userId.toString(),
    );

    if (isConnected) {
      await Job.findByIdAndUpdate(jobId, { $pull: { connections: userId } });
      return res.status(200).json({ message: "Removed from connections" });
    }

    await Job.findByIdAndUpdate(jobId, { $addToSet: { connections: userId } });
    return res.status(200).json({ message: "Added to connections successfully" });
  } catch (error) {
    console.error("Error toggling connection:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const submitJobPost = async (req, res) => {
  try {
    const {
      companyName,
      aboutCompany,
      website,
      instagram,
      linkedin,
      companySize,
      visualAssets,
      jobTitle,
      jobCategory,
      applicationLink,
      location,
      workplaceType,
      contractType,
      salaryRange,
      currency,
      overview,
      allowInternalConnections,
      submitterName,
      submitterEmail,
    } = req.body;

    if (!companyName || !companyName.trim()) {
      return res.status(400).json({ message: "Company or Studio name is required." });
    }
    if (!jobTitle || !jobTitle.trim()) {
      return res.status(400).json({ message: "Job title is required." });
    }
    if (!jobCategory) {
      return res.status(400).json({ message: "Job category is required." });
    }

    const newJob = await Job.create({
      companyName: companyName.trim(),
      aboutCompany: aboutCompany?.trim() || "",
      website: website?.trim() || "",
      instagram: instagram?.trim() || "",
      linkedin: linkedin?.trim() || "",
      companySize: companySize?.trim() || "",
      visualAssets: Array.isArray(visualAssets) ? visualAssets : [],
      jobTitle: jobTitle.trim(),
      jobCategory,
      applicationLink: applicationLink?.trim() || "",
      location: location?.trim() || "",
      workplaceType: workplaceType || "On-site",
      contractType: contractType || "Full-time",
      salaryRange: salaryRange?.trim() || "",
      currency: currency || "$",
      overview: overview?.trim() || "",
      allowInternalConnections: Boolean(allowInternalConnections),
      status: "pending",
      submitterName:
        submitterName?.trim() ||
        req.user?.fullName ||
        req.user?.username ||
        "",
      submitterEmail: submitterEmail?.trim() || req.user?.email || "",
      postedBy: req.user?._id || null,
    });

    const populatedJob = await Job.findById(newJob._id).populate(
      "jobCategory",
      "name position"
    );

    return res.status(201).json({
      success: true,
      message: "Job post submitted successfully and is pending review.",
      data: populatedJob,
    });
  } catch (error) {
    console.error("Error submitting job post:", error);
    return res
      .status(500)
      .json({ message: error.message || "Internal Server Error" });
  }
};


