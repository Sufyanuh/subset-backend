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
      jobCategories,
      applicationLink,
      location,
      workplaceType,
      contractType,
      salaryRange,
      currency,
      overview,
      listingDuration,
      allowInternalConnections,
      status,
    } = req.body;

    if (!companyName || !companyName.trim()) {
      return res.status(400).json({ message: "Company name is required." });
    }
    if (!jobTitle || !jobTitle.trim()) {
      return res.status(400).json({ message: "Job title is required." });
    }

    const finalCategories = Array.isArray(jobCategories)
      ? jobCategories.filter(Boolean)
      : jobCategory
      ? [jobCategory]
      : [];

    if (!finalCategories.length && !jobCategory) {
      return res.status(400).json({ message: "Job category is required." });
    }

    const primaryCategory = finalCategories[0] || jobCategory || null;

    const job = await Job.create({
      companyName: companyName.trim(),
      aboutCompany: aboutCompany || "",
      website: website?.trim() || "",
      instagram: instagram?.trim() || "",
      linkedin: linkedin?.trim() || "",
      companySize: companySize?.trim() || "",
      visualAssets: Array.isArray(visualAssets) ? visualAssets : [],
      jobTitle: jobTitle.trim(),
      jobCategory: primaryCategory,
      jobCategories: finalCategories,
      applicationLink: applicationLink?.trim() || "",
      location: location?.trim() || "",
      workplaceType: workplaceType || "On-site",
      contractType: contractType || "Full-time",
      salaryRange: salaryRange?.trim() || "",
      currency: currency || "$",
      overview: overview || "",
      listingDuration: listingDuration || "30 Days",
      allowInternalConnections: Boolean(allowInternalConnections),
      status: status || "active",
      postedBy: req.user?._id || null,
    });

    const populatedJob = await Job.findById(job._id)
      .populate("jobCategory", "name position")
      .populate("jobCategories", "name position");

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
      page,
      limit,
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
      const catArray = Array.isArray(category)
        ? category.filter(Boolean)
        : typeof category === "string"
        ? category
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s && s !== "All")
        : [category];

      if (catArray.length > 0) {
        filter.$or = [
          ...(filter.$or || []),
          { jobCategory: { $in: catArray } },
          { jobCategories: { $in: catArray } },
        ];
      }
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

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    let query = Job.find(filter)
      .populate("jobCategory", "name position")
      .populate("jobCategories", "name position")
      .populate("postedBy", "fullName firstName lastName username email avatar profilePicture")
      .populate("connections", "fullName username email avatar title")
      .populate("savedByUsers", "fullName username email avatar title")
      .sort(sortOption);

    if (pageNum && limitNum) {
      const total = await Job.countDocuments(filter);
      const jobs = await query.skip((pageNum - 1) * limitNum).limit(limitNum);
      const totalPages = Math.ceil(total / limitNum);

      return res.status(200).json({
        message: "Jobs fetched successfully",
        data: jobs,
        total,
        page: pageNum,
        totalPages,
        hasMore: pageNum < totalPages,
      });
    }

    const jobs = await query;

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
      .populate("jobCategories", "name position")
      .populate("postedBy", "fullName firstName lastName username email avatar profilePicture")
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
    if (req.body.jobCategories !== undefined) {
      updateData.jobCategories = Array.isArray(req.body.jobCategories)
        ? req.body.jobCategories.filter(Boolean)
        : [];
      if (updateData.jobCategories.length > 0 && !updateData.jobCategory) {
        updateData.jobCategory = updateData.jobCategories[0];
      }
    }
    if (applicationLink !== undefined)
      updateData.applicationLink = applicationLink.trim();
    if (location !== undefined) updateData.location = location.trim();
    if (workplaceType !== undefined) updateData.workplaceType = workplaceType;
    if (contractType !== undefined) updateData.contractType = contractType;
    if (salaryRange !== undefined) updateData.salaryRange = salaryRange.trim();
    if (currency !== undefined) updateData.currency = currency;
    if (overview !== undefined) updateData.overview = overview;
    if (req.body.listingDuration !== undefined)
      updateData.listingDuration = req.body.listingDuration;
    if (allowInternalConnections !== undefined)
      updateData.allowInternalConnections = Boolean(allowInternalConnections);
    if (req.body.isEdited !== undefined) updateData.isEdited = req.body.isEdited;
    if (req.body.editedFields !== undefined) updateData.editedFields = req.body.editedFields;
    if (req.body.editedFieldChanges !== undefined)
      updateData.editedFieldChanges = req.body.editedFieldChanges;
    if (status !== undefined) {
      updateData.status = status;
      if (status === "active" && req.body.isEdited === undefined) {
        updateData.isEdited = false;
        updateData.editedFields = [];
        updateData.editedFieldChanges = [];
      }
    }

    const updatedJob = await Job.findByIdAndUpdate(id, updateData, {
      new: true,
    })
      .populate("jobCategory", "name position")
      .populate("jobCategories", "name position");

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

// ❌ Delete Multiple Jobs
export const deleteMultipleJobs = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "Array of job IDs is required" });
    }

    await Job.deleteMany({ _id: { $in: ids } });

    return res.status(200).json({ message: "Jobs deleted successfully" });
  } catch (error) {
    console.error("Error deleting multiple jobs:", error);
    return res.status(500).json({ message: error.message, error });
  }
};

export const UpdateJobStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const updateObj = { status };
    if (status === "active") {
      updateObj.isEdited = false;
      updateObj.editedFields = [];
      updateObj.editedFieldChanges = [];
    }
    const job = await Job.findByIdAndUpdate(
      id,
      updateObj,
      { new: true }
    ).populate("jobCategory", "name position");
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    return res.status(200).json({
      message: "Job status updated successfully",
      data: job,
    });
  } catch (error) {
    console.error("Error updating job status:", error);
    return res.status(500).json({ message: error.message, error });
  }
};

export const updateJobStatus = UpdateJobStatus;

export const approveJob = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await Job.findByIdAndUpdate(
      id,
      { status: "active", isEdited: false, editedFields: [], editedFieldChanges: [] },
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

export const getPendingJobsCount = async (req, res) => {
  try {
    const count = await Job.countDocuments({ status: "pending" });
    return res.status(200).json({
      success: true,
      count,
    });
  } catch (error) {
    console.error("Error fetching pending jobs count:", error);
    return res.status(500).json({ message: error.message, error });
  }
};

