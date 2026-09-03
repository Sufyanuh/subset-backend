import { Job } from "../../model/job.js";
import { JobCategory } from "../../model/jobCategory.js";

// ➕ Create Job
export const CreateJob = async (req, res) => {
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
      status,
    } = req.body;

    if (!companyName || !companyName.trim()) {
      return res.status(400).json({ message: "Company name is required." });
    }
    if (!jobTitle || !jobTitle.trim()) {
      return res.status(400).json({ message: "Job title is required." });
    }
    if (!jobCategory) {
      return res.status(400).json({ message: "Job category is required." });
    }

    const job = await Job.create({
      companyName: companyName.trim(),
      aboutCompany: aboutCompany || "",
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
      overview: overview || "",
      allowInternalConnections: Boolean(allowInternalConnections),
      status: status || "active",
      postedBy: req.user?._id || null,
    });

    const populatedJob = await Job.findById(job._id).populate(
      "jobCategory",
      "name position",
    );

    return res.status(201).json({
      message: "Job created successfully",
      data: populatedJob,
    });
  } catch (error) {
    console.error("Error creating job:", error);
    return res.status(500).json({ message: error.message, error });
  }
};

// 📥 Get All Jobs (Admin & Public with filtering)
export const GetJobs = async (req, res) => {
  try {
    const {
      search,
      category,
      workplaceType,
      contractType,
      location,
      status,
      spotLight,
      sort,
    } = req.query;

    const filter = {};

    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: "i" };

      // Find any categories matching the search text to include their IDs
      const matchingCategories = await JobCategory.find({
        name: searchRegex,
      }).select("_id");
      const categoryIds = matchingCategories.map((c) => c._id);

      filter.$or = [
        { jobTitle: searchRegex },
        { companyName: searchRegex },
        { aboutCompany: searchRegex },
        { location: searchRegex },
        { overview: searchRegex },
        { workplaceType: searchRegex },
        { contractType: searchRegex },
        { salaryRange: searchRegex },
        ...(categoryIds.length > 0
          ? [{ jobCategory: { $in: categoryIds } }]
          : []),
      ];
    }

    if (category && category !== "All") {
      filter.jobCategory = category;
    }

    if (workplaceType && workplaceType !== "All") {
      filter.workplaceType = workplaceType;
    }

    if (contractType && contractType !== "All") {
      filter.contractType = contractType;
    }

    if (location && location !== "All") {
      filter.location = { $regex: location, $options: "i" };
    }

    if (status) {
      filter.status = status;
    } else if (
      !req.baseUrl?.includes("/admin") &&
      !req.path?.includes("/admin")
    ) {
      // For public endpoints default to active jobs
      filter.status = "active";
    }

    if (spotLight !== undefined) {
      filter.spotLight = spotLight === "true" || spotLight === true;
    }

    let sortOption = { createdAt: -1 };
    if (sort === "oldest") {
      sortOption = { createdAt: 1 };
    }

    const jobs = await Job.find(filter)
      .populate("jobCategory", "name position")
      .populate("connections", "fullName username email avatar title")
      .populate("savedByUsers", "fullName username email avatar title")
      .sort(sortOption);

    return res.status(200).json({
      message: "Jobs fetched successfully",
      data: jobs,
    });
  } catch (error) {
    console.error("Error fetching jobs:", error);
    return res.status(500).json({ message: error.message, error });
  }
};

// 📥 Get Single Job By ID
export const GetJobById = async (req, res) => {
  const { id } = req.params;
  try {
    const job = await Job.findById(id)
      .populate("jobCategory", "name position")
      .populate("connections", "fullName username email avatar title")
      .populate("savedByUsers", "fullName username email avatar title");
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    return res.status(200).json({
      message: "Job fetched successfully",
      data: job,
    });
  } catch (error) {
    console.error("Error fetching job by id:", error);
    return res.status(500).json({ message: error.message, error });
  }
};

// ✏️ Update Job
export const UpdateJob = async (req, res) => {
  const { id } = req.params;
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
      status,
    } = req.body;

    const updateData = {};
    if (companyName !== undefined) updateData.companyName = companyName.trim();
    if (aboutCompany !== undefined) updateData.aboutCompany = aboutCompany;
    if (website !== undefined) updateData.website = website.trim();
    if (instagram !== undefined) updateData.instagram = instagram.trim();
    if (linkedin !== undefined) updateData.linkedin = linkedin.trim();
    if (companySize !== undefined) updateData.companySize = companySize.trim();
    if (visualAssets !== undefined) updateData.visualAssets = visualAssets;
    if (jobTitle !== undefined) updateData.jobTitle = jobTitle.trim();
    if (jobCategory !== undefined) updateData.jobCategory = jobCategory;
    if (applicationLink !== undefined)
      updateData.applicationLink = applicationLink.trim();
    if (location !== undefined) updateData.location = location.trim();
    if (workplaceType !== undefined) updateData.workplaceType = workplaceType;
    if (contractType !== undefined) updateData.contractType = contractType;
    if (salaryRange !== undefined) updateData.salaryRange = salaryRange.trim();
    if (currency !== undefined) updateData.currency = currency;
    if (overview !== undefined) updateData.overview = overview;
    if (allowInternalConnections !== undefined)
      updateData.allowInternalConnections = Boolean(allowInternalConnections);
    if (status !== undefined) updateData.status = status;

    const updatedJob = await Job.findByIdAndUpdate(id, updateData, {
      new: true,
    }).populate("jobCategory", "name position");

    if (!updatedJob) {
      return res.status(404).json({ message: "Job not found" });
    }

    return res.status(200).json({
      message: "Job updated successfully",
      data: updatedJob,
    });
  } catch (error) {
    console.error("Error updating job:", error);
    return res.status(500).json({ message: error.message, error });
  }
};

// ❌ Delete Job
export const DeleteJob = async (req, res) => {
  const { id } = req.params;
  try {
    const job = await Job.findByIdAndDelete(id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    return res.status(200).json({
      message: "Job deleted successfully",
      data: job,
    });
  } catch (error) {
    console.error("Error deleting job:", error);
    return res.status(500).json({ message: error.message, error });
  }
};

export const updateJobStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const job = await Job.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    ).populate("jobCategory", "name position");
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    return res.status(200).json({
      message: `Job status updated to ${status} successfully`,
      data: job,
    });
  } catch (error) {
    console.error("Error updating job status:", error);
    return res.status(500).json({ message: error.message, error });
  }
};

export const approveJob = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findByIdAndUpdate(
      id,
      { status: "active" },
      { new: true }
    ).populate("jobCategory", "name position");
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    return res.status(200).json({
      message: "Job approved and activated successfully",
      data: job,
    });
  } catch (error) {
    console.error("Error approving job:", error);
    return res.status(500).json({ message: error.message, error });
  }
};

export const rejectJob = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findByIdAndUpdate(
      id,
      { status: "rejected" },
      { new: true }
    ).populate("jobCategory", "name position");
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    return res.status(200).json({
      message: "Job submission rejected",
      data: job,
    });
  } catch (error) {
    console.error("Error rejecting job:", error);
    return res.status(500).json({ message: error.message, error });
  }
};

export const ToggleSpotLight = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findById(id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    job.spotLight = !job.spotLight;
    await job.save();
    return res.status(200).json({
      message: "Job updated successfully",
      data: job,
    });
  } catch (error) {
    console.error("Error toggling job spotlight:", error);
    return res.status(500).json({ message: error.message, error });
  }
};

export const getSpotlightJobs = async (req, res) => {
  try {
    const jobs = await Job.find({ spotLight: true, status: "active" })
      .populate("jobCategory", "name position")
      .populate("connections", "fullName username email avatar title")
      .populate("savedByUsers", "fullName username email avatar title")
      .sort({ createdAt: -1 });
    return res.status(200).json({
      message: "Spotlight jobs fetched successfully",
      data: jobs,
    });
  } catch (error) {
    console.error("Error fetching spotlight jobs:", error);
    return res.status(500).json({ message: error.message, error });
  }
};
