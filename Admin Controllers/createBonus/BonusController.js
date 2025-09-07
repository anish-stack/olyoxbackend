const Bonus = require("../../models/Bonus_Model/Bonus_Model");

;

exports.createBonus = async (req, res) => {
  try {
    const { requiredHours, bonusCouponCode, bonusType, bonusValue, bonusStatus, any_required_field } = req.body;

    const newBonus = new Bonus({
      requiredHours,
      bonusCouponCode,
      bonusType,
      bonusValue,
      bonusStatus,
      any_required_field,
      anyRequiredField: any_required_field,
    });

    await newBonus.save();

    return res.status(201).json({
      success: true,
      message: 'Bonus created successfully!',
      data: newBonus,
    });
  } catch (error) {
    console.error('Error creating bonus:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while creating the bonus.',
      error: error.message,
    });
  }
};

exports.getAllBonuses = async (req, res) => {
  try {
    const bonuses = await Bonus.find();

    return res.status(200).json({
      success: true,
      data: bonuses,
    });
  } catch (error) {
    console.error('Error fetching bonuses:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching bonuses.',
      error: error.message,
    });
  }
};


exports.getBonusById = async (req, res) => {
  try {
    const { id } = req.params;
    const bonus = await Bonus.findById(id);

    if (!bonus) {
      return res.status(404).json({
        success: false,
        message: 'Bonus not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: bonus,
    });
  } catch (error) {
    console.error('Error fetching bonus:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching the bonus.',
      error: error.message,
    });
  }
};


exports.updateBonus = async (req, res) => {
  try {
    const { id } = req.params;
    const { requiredHours, bonusCouponCode, bonusType, bonusValue, bonusStatus, any_required_field } = req.body;

    const bonus = await Bonus.findById(id);

    if (!bonus) {
      return res.status(404).json({
        success: false,
        message: 'Bonus not found',
      });
    }


    bonus.requiredHours = requiredHours || bonus.requiredHours;
    bonus.bonusCouponCode = bonusCouponCode || bonus.bonusCouponCode;
    bonus.bonusType = bonusType || bonus.bonusType;
    bonus.bonusValue = bonusValue || bonus.bonusValue;
    bonus.bonusStatus = bonusStatus || bonus.bonusStatus;
    bonus.any_required_field = any_required_field || bonus.any_required_field;
    bonus.anyRequiredField = any_required_field || bonus.anyRequiredField;

    await bonus.save();

    return res.status(200).json({
      success: true,
      message: 'Bonus updated successfully!',
      data: bonus,
    });
  } catch (error) {
    console.error('Error updating bonus:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while updating the bonus.',
      error: error.message,
    });
  }
};


exports.deleteBonus = async (req, res) => {
  try {
    const { id } = req.params;

    const bonus = await Bonus.findByIdAndDelete(id);

    if (!bonus) {
      return res.status(404).json({
        success: false,
        message: 'Bonus not found',
      });
    }

    // await bonus.remove();

    return res.status(200).json({
      success: true,
      message: 'Bonus deleted successfully!',
    });
  } catch (error) {
    console.error('Error deleting bonus:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while deleting the bonus.',
      error: error.message,
    });
  }
};


exports.updateBonusStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { bonusStatus } = req.body;
    const findBonus = await Bonus.findById(id)
    if (!findBonus) {
      return res.status(400).json({
        success: false,
        message: 'Bonus not found'
      })
    }
    findBonus.bonusStatus = bonusStatus;
    await findBonus.save()
    return res.status(200).json({
      success: true,
      message: 'Bonus status updated successfully',
      data: findBonus
    })
  } catch (error) {
    console.log("Internal server error", error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    })
  }
}