/**
 * WeatherWise AI - Automated Unit Test Suite
 * Validates heuristic decision accuracy, profile compliance, and safety flags.
 */

const Tests = [];

function addTest(name, runFn) {
    Tests.push({ name, runFn });
}

// Mocking STATE for unit tests in isolation
const testUnitState = {
    currentUnit: "metric"
};

// Expose or reference test assertions
function assert(condition, message) {
    if (!condition) {
        throw new Error(message || "Assertion failed");
    }
}

function assertEquals(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message || "Assertion failed"} -> Expected: ${expected}, Actual: ${actual}`);
    }
}

// ----------------------------------------------------
// TEST CASES
// ----------------------------------------------------

addTest("Standard Profile - Perfect Sunny Day Heuristic", () => {
    const mockWeather = {
        main: { temp: 24, humidity: 45, feels_like: 24 },
        wind: { speed: 3 }, // m/s (10.8 km/h)
        clouds: { all: 10 },
        weather: [{ id: 800, description: "clear sky" }], // Clear
        coord: { lat: 17.385 } // Hyderabad
    };
    
    const mockPollution = {
        list: [{ main: { aqi: 1 } }] // Good
    };

    // Run heuristics
    const result = runWeatherHeuristics(mockWeather, mockPollution, "standard");
    
    // Assertions
    assert(result.activityScore >= 95, "Perfect conditions should yield score >= 95");
    assert(result.clothing.includes("Standard attire"), "Should suggest normal clothing");
    assertEquals(result.backgroundTheme, "weather-sunny", "Should trigger sunny theme");
});

addTest("Runner Profile - Heat & High Wind Constraints", () => {
    const mockWeather = {
        main: { temp: 28, humidity: 60, feels_like: 30 },
        wind: { speed: 8 }, // m/s (28.8 km/h) - High wind for runner
        clouds: { all: 20 },
        weather: [{ id: 801, description: "few clouds" }],
        coord: { lat: 17.385 }
    };
    
    const mockPollution = {
        list: [{ main: { aqi: 1 } }]
    };

    const result = runWeatherHeuristics(mockWeather, mockPollution, "runner");
    
    // Deductions should trigger since temp (28) > runner max (22)
    // and wind (28.8) > runner windLimit (18)
    assert(result.activityScore < 70, "Runners should have lower score in hot/windy weather");
    assert(result.deductions.some(d => d.includes("High Winds")), "Should list wind deduction");
    assert(result.deductions.some(d => d.includes("High Temperature")), "Should list temperature deduction");
});

addTest("Sensitive Profile - Air Quality Alert", () => {
    const mockWeather = {
        main: { temp: 22, humidity: 40, feels_like: 22 },
        wind: { speed: 2 },
        clouds: { all: 50 },
        weather: [{ id: 802, description: "scattered clouds" }],
        coord: { lat: 17.385 }
    };
    
    // Poor air quality (AQI = 4)
    const mockPollution = {
        list: [{ main: { aqi: 4 } }]
    };

    const result = runWeatherHeuristics(mockWeather, mockPollution, "sensitive");

    assert(result.activityScore < 60, "Sensitive groups should see steep score drop on high AQI");
    assert(result.clothing.includes("N95 mask"), "Should recommend N95 mask");
    assert(result.deductions.some(d => d.includes("Poor Air Quality")), "Should alert on air quality deduction");
});

addTest("Standard Profile - Storm Hazard Travel Advisory", () => {
    const mockWeather = {
        main: { temp: 19, humidity: 95, feels_like: 18 },
        wind: { speed: 12 }, // 43.2 km/h
        clouds: { all: 99 },
        weather: [{ id: 201, description: "thunderstorm with rain" }],
        coord: { lat: 17.385 }
    };
    
    const mockPollution = {
        list: [{ main: { aqi: 2 } }]
    };

    const result = runWeatherHeuristics(mockWeather, mockPollution, "standard");

    assert(result.activityScore <= 35, "Storm should drop score below 35");
    assert(result.travel.includes("Hazardous"), "Should flag driving hazard in storm");
    assertEquals(result.backgroundTheme, "weather-stormy", "Should trigger storm theme background");
});

addTest("Standard Profile - Cold Snowy Winter Heuristic", () => {
    const mockWeather = {
        main: { temp: -2, humidity: 80, feels_like: -6 },
        wind: { speed: 4 },
        clouds: { all: 90 },
        weather: [{ id: 601, description: "snow" }],
        coord: { lat: 40.712 } // New York
    };
    
    const mockPollution = {
        list: [{ main: { aqi: 1 } }]
    };

    const result = runWeatherHeuristics(mockWeather, mockPollution, "standard");

    assert(result.activityScore < 50, "Snowy sub-zero weather should yield score < 50");
    assert(result.clothing.includes("puffer coat") || result.clothing.includes("layers"), "Should suggest heavy insulation layers");
    assertEquals(result.backgroundTheme, "weather-snowy", "Should trigger snowy theme");
});

// ----------------------------------------------------
// TEST RUNNER ENGINE
// ----------------------------------------------------
async function runAllUnitTests() {
    const resultsContainer = document.getElementById("testResults");
    resultsContainer.innerHTML = "";
    
    let passedCount = 0;
    let failedCount = 0;
    
    for (const test of Tests) {
        const row = document.createElement("tr");
        const nameCell = document.createElement("td");
        nameCell.textContent = test.name;
        nameCell.className = "test-name";
        
        const statusCell = document.createElement("td");
        const detailsCell = document.createElement("td");
        detailsCell.className = "test-details";
        
        try {
            // Run the individual test
            test.runFn();
            
            statusCell.innerHTML = `<span class="badge badge-pass">PASS</span>`;
            detailsCell.textContent = "All assertions executed successfully.";
            row.className = "row-pass";
            passedCount++;
        } catch (error) {
            statusCell.innerHTML = `<span class="badge badge-fail">FAIL</span>`;
            detailsCell.textContent = error.message;
            row.className = "row-fail";
            failedCount++;
            console.error(`Test Fail: ${test.name}`, error);
        }
        
        row.appendChild(nameCell);
        row.appendChild(statusCell);
        row.appendChild(detailsCell);
        resultsContainer.appendChild(row);
    }
    
    // Update summary counters
    document.getElementById("totalTests").textContent = Tests.length;
    document.getElementById("passedCount").textContent = passedCount;
    document.getElementById("failedCount").textContent = failedCount;
    
    const summaryCard = document.getElementById("summaryStatusCard");
    summaryCard.className = "summary-card";
    if (failedCount > 0) {
        summaryCard.classList.add("fail-theme");
        document.getElementById("summaryHeadline").textContent = "Test Run Failed";
    } else {
        summaryCard.classList.add("pass-theme");
        document.getElementById("summaryHeadline").textContent = "All Tests Passed!";
    }
}
