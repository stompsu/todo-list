using System.Text.Json;
using TodoBoard.Api.Board;

namespace TodoBoard.Api.Tests;

public sealed class BoardValidationTests
{
    private static BoardInput Valid() => JsonSerializer.Deserialize<BoardInput>(Boards.Sample, BoardJson.Request)!;

    [Theory]
    [InlineData("id", BoardLimits.MaxIdLength)]
    [InlineData("name", BoardLimits.MaxCategoryNameLength)]
    [InlineData("title", BoardLimits.MaxTaskTitleLength)]
    [InlineData("description", BoardLimits.MaxTaskDescriptionLength)]
    public void FieldLimits_AcceptBoundary_RejectNextCharacter(string field, int maximum)
    {
        foreach (var length in new[] { maximum, maximum + 1 })
        {
            var input = Valid();
            var text = new string('x', length);
            switch (field)
            {
                case "id": input.Tasks![0]!.Id = text; break;
                case "name": input.Categories![0]!.Name = text; break;
                case "title": input.Tasks![0]!.Title = text; break;
                case "description": input.Tasks![0]!.Description = text; break;
            }
            Assert.Equal(length == maximum, BoardValidator.Validate(input).IsValid);
        }
    }

    [Theory]
    [InlineData("id")]
    [InlineData("title")]
    [InlineData("description")]
    [InlineData("color")]
    [InlineData("status")]
    public void NonNullableTaskProperties_RejectNull(string field)
    {
        var input = Valid();
        var task = input.Tasks![0]!;
        switch (field)
        {
            case "id": task.Id = null; break;
            case "title": task.Title = null; break;
            case "description": task.Description = null; break;
            case "color": task.Color = null; break;
            case "status": task.Status = null; break;
        }
        Assert.False(BoardValidator.Validate(input).IsValid);
    }

    [Fact]
    public void CategoryCount_AcceptsBoundary_RejectsNext()
    {
        var input = Valid();
        input.Tasks = [];
        input.Categories = Enumerable.Range(0, BoardLimits.MaxCategories)
            .Select(i => (CategoryInput?)new CategoryInput { Id = i.ToString(), Name = "Category" }).ToList();
        Assert.True(BoardValidator.Validate(input).IsValid);
        input.Categories.Add(new CategoryInput { Id = "extra", Name = "Category" });
        Assert.False(BoardValidator.Validate(input).IsValid);
    }

    [Theory]
    [InlineData("#123456\n")]
    [InlineData("#123456 ")]
    [InlineData("#12345")]
    [InlineData("#1234567")]
    public void Color_MustBeExactlySixHexDigits(string color)
    {
        var input = Valid();
        input.Tasks![0]!.Color = color;
        Assert.False(BoardValidator.Validate(input).IsValid);
    }

    [Fact]
    public void ImportSemantics_PreserveTextColorsOrderAndDuplicateCategoryNames()
    {
        var input = Valid();
        input.Categories![0]!.Name = " Same ";
        input.Categories[1]!.Name = " Same ";
        input.Tasks![0]!.Title = " Keep whitespace ";
        input.Tasks[0]!.Color = "#AbCdEf";
        var result = BoardValidator.Validate(input);
        Assert.True(result.IsValid);
        Assert.Equal(input.Categories.Select(c => c!.Name), result.Board!.Categories.Select(c => c.Name));
        Assert.Equal(" Keep whitespace ", result.Board.Tasks[0].Title);
        Assert.Equal("#AbCdEf", result.Board.Tasks[0].Color);
        Assert.Equal(input.Tasks.Select(t => t!.Id), result.Board.Tasks.Select(t => t.Id));
    }

    [Fact]
    public void ValidationErrors_AreBounded()
    {
        var result = BoardValidator.Validate(new BoardInput
        {
            Version = 1, Categories = [], Tasks = Enumerable.Repeat<TaskInput?>(null, BoardLimits.MaxTasks).ToList(),
        });
        Assert.False(result.IsValid);
        Assert.Equal(BoardLimits.MaxReportedErrors, result.Errors.Count);
    }
}
