const HeavyVehicleCategory = require('../../models/Heavy_vehicle/Heavy_Vehicle_Categories');


exports.createCategory = async (req, res) => {
  try {

    if (!req.body.title) {
      return res.status(400).json({
        success: false,
        message: 'Category title is required'
      });
    }

    const existingCategory = await HeavyVehicleCategory.findOne({ 
      title: { $regex: new RegExp(`^${req.body.title}$`, 'i') } 
    });

    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: 'A category with this title already exists'
      });
    }

    const categoryData = {
      title: req.body.title,
      active: req.body.active !== undefined ? req.body.active : true
    };

    const category = await HeavyVehicleCategory.create(categoryData);

    return res.status(201).json({
      success: true,
      message: 'Heavy vehicle category created successfully',
      data: category
    });
  } catch (error) {
    console.error('Error creating heavy vehicle category:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create heavy vehicle category',
      error: error.message
    });
  }
};


exports.getAllCategories = async (req, res) => {
  try {
    const { active, title, sort } = req.query;
    const filter = {};

  
    if (active !== undefined) {
      filter.active = active === 'true';
    }

    if (title) {
      filter.title = { $regex: title, $options: 'i' }; 
    }

  
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

 
    let sortOption = { createdAt: -1 };
    if (sort) {
      if (sort === 'title-asc') sortOption = { title: 1 };
      else if (sort === 'title-desc') sortOption = { title: -1 };
      else if (sort === 'newest') sortOption = { createdAt: -1 };
      else if (sort === 'oldest') sortOption = { createdAt: 1 };
    }


    const categories = await HeavyVehicleCategory.find(filter)
      .sort(sortOption)
      .skip(skip)
      .limit(limit);


    const totalCategories = await HeavyVehicleCategory.countDocuments(filter);

    return res.status(200).json({
      success: true,
      count: categories.length,
      totalPages: Math.ceil(totalCategories / limit),
      currentPage: page,
      data: categories
    });
  } catch (error) {
    console.error('Error fetching heavy vehicle categories:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch heavy vehicle categories',
      error: error.message
    });
  }
};

exports.getCategory = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Category ID is required'
      });
    }

    const category = await HeavyVehicleCategory.findById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Heavy vehicle category not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: category
    });
  } catch (error) {
    console.error('Error fetching heavy vehicle category:', error);
    
    // Handle invalid ID format
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid category ID format'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch heavy vehicle category',
      error: error.message
    });
  }
};


exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Category ID is required'
      });
    }


    const category = await HeavyVehicleCategory.findById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Heavy vehicle category not found'
      });
    }


    if (req.body.title && req.body.title !== category.title) {
      const existingCategory = await HeavyVehicleCategory.findOne({
        _id: { $ne: id },
        title: { $regex: new RegExp(`^${req.body.title}$`, 'i') }
      });

      if (existingCategory) {
        return res.status(400).json({
          success: false,
          message: 'A category with this title already exists'
        });
      }
    }


    const updateData = {};
    if (req.body.title !== undefined) updateData.title = req.body.title;
    if (req.body.active !== undefined) updateData.active = req.body.active;


    const updatedCategory = await HeavyVehicleCategory.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Heavy vehicle category updated successfully',
      data: updatedCategory
    });
  } catch (error) {
    console.error('Error updating heavy vehicle category:', error);
    
    // Handle invalid ID format
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid category ID format'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to update heavy vehicle category',
      error: error.message
    });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Category ID is required'
      });
    }


    const category = await HeavyVehicleCategory.findById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Heavy vehicle category not found'
      });
    }


    await HeavyVehicleCategory.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: 'Heavy vehicle category deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting heavy vehicle category:', error);
    

    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid category ID format'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to delete heavy vehicle category',
      error: error.message
    });
  }
};


exports.toggleStatus = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Category ID is required'
      });
    }

    // Check if category exists
    const category = await HeavyVehicleCategory.findById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Heavy vehicle category not found'
      });
    }

    // Toggle active status
    category.active = !category.active;
    await category.save();

    return res.status(200).json({
      success: true,
      message: `Heavy vehicle category ${category.active ? 'activated' : 'deactivated'} successfully`,
      data: category
    });
  } catch (error) {
    console.error('Error toggling heavy vehicle category status:', error);
    
    // Handle invalid ID format
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid category ID format'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to toggle heavy vehicle category status',
      error: error.message
    });
  }
};